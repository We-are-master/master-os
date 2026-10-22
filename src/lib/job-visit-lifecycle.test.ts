/**
 * O job segue a visita ativa (dono, 22/10/2026): visita nova devolve o job ao
 * ciclo, e o pagamento fica como está.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activeVisit, hasOpenVisit, jobStatusFromVisits } from "@/lib/job-visit-lifecycle";
import { followActiveVisit } from "@/lib/job-visit-lifecycle-server";
import { jobAfterVisitReport } from "@/lib/job-visit-advance-server";
import { fakeSupabase } from "@/lib/client-confirmation/fake-supabase.test-helper";

type Row = Record<string, unknown>;

const V1 = {
  scheduled_date: "2026-10-20",
  scheduled_start_at: "2026-10-20T08:00:00Z",
  scheduled_end_at: "2026-10-20T11:00:00Z",
};

function job(over: Row = {}): Row {
  return {
    id: "j9705",
    reference: "JOB-9705",
    status: "final_check",
    ...V1,
    expected_finish_at: null,
    primary_visit_done: null,
    partner_id: "p1",
    invoice_id: "inv-1",
    customer_deposit_paid: true,
    customer_final_paid: false,
    timer_is_running: false,
    timer_elapsed_seconds: 0,
    timer_last_started_at: null,
    partner_timer_started_at: null,
    partner_timer_ended_at: null,
    ...over,
  };
}

function visit(over: Row = {}): Row {
  return {
    id: "v3",
    job_id: "j9705",
    visit_index: 3,
    status: "scheduled",
    scheduled_date: "2026-10-23",
    scheduled_start_at: "2026-10-23T07:00:00Z",
    scheduled_end_at: "2026-10-23T08:00:00Z",
    deleted_at: null,
    ...over,
  };
}

function montar(jobRow: Row, visits: Row[], extra: Record<string, Row[]> = {}) {
  const fake = fakeSupabase({ jobs: [jobRow], job_visits: visits, audit_logs: [], ...extra });
  const zendesk: string[] = [];
  const syncZendesk = async (id: string) => { zendesk.push(id); };
  const statusLog = () =>
    (fake.tabelas.audit_logs ?? [])
      .filter((a) => a.action === "status_changed")
      .map((a) => `${a.old_value}→${a.new_value}`);
  return { fake, zendesk, syncZendesk, statusLog, job: () => fake.tabelas.jobs[0] as Row };
}

describe("jobStatusFromVisits (regra pura)", () => {
  it("job em Final review ganha visita: volta para Scheduled no dia dela, V1 guardada", () => {
    const step = jobStatusFromVisits(job() as never, [visit()] as never, { now: new Date("2026-10-22T12:00:00Z") });
    assert.ok(step);
    assert.equal(step.status, "scheduled");
    assert.equal(step.reopened, true);
    assert.equal(step.patch.scheduled_date, "2026-10-23");
    assert.deepEqual(step.patch.primary_visit_done, { ...V1, done_at: "2026-10-22T12:00:00.000Z" });
  });

  it("Awaiting payment e Completed também voltam; cancelado, on hold e sem parceiro não", () => {
    for (const s of ["awaiting_payment", "completed", "need_attention"]) {
      assert.equal(jobStatusFromVisits(job({ status: s }) as never, [visit()] as never)?.status, "scheduled", s);
    }
    for (const s of ["cancelled", "on_hold", "unassigned", "auto_assigning", "deleted"]) {
      assert.equal(jobStatusFromVisits(job({ status: s }) as never, [visit()] as never), null, s);
    }
  });

  it("job em campo com a V1 por fazer não muda por causa da V2", () => {
    assert.equal(jobStatusFromVisits(job({ status: "scheduled" }) as never, [visit()] as never), null);
    assert.equal(jobStatusFromVisits(job({ status: "in_progress" }) as never, [visit()] as never), null);
  });

  it("visita começou → In progress; visita em andamento manda mais que a próxima marcada", () => {
    const seguindo = job({ status: "scheduled", primary_visit_done: { ...V1, done_at: "x" } });
    const visits = [visit({ id: "v2", visit_index: 2, scheduled_date: "2026-10-22" }), visit({ status: "in_progress" })];
    assert.equal(activeVisit(visits as never)?.id, "v3");
    assert.equal(jobStatusFromVisits(seguindo as never, visits as never)?.status, "in_progress");
  });

  it("visita feita, cancelada ou sem data não reabre nada", () => {
    for (const v of [visit({ status: "completed" }), visit({ status: "cancelled" }), visit({ scheduled_date: null }), visit({ deleted_at: "x" })]) {
      assert.equal(jobStatusFromVisits(job() as never, [v] as never), null);
    }
  });

  it("todas as visitas feitas: o job segue o caminho de sempre (nada muda aqui)", () => {
    assert.equal(jobStatusFromVisits(job() as never, [visit({ status: "completed" })] as never), null);
    assert.equal(hasOpenVisit([{ status: "completed", deleted_at: null }]), false);
    assert.equal(hasOpenVisit([{ status: "scheduled", deleted_at: null }]), true);
  });

  it("job já no horário da visita ativa e no status dela: nada a fazer", () => {
    const certo = job({ ...visit(), id: "j9705", status: "scheduled", primary_visit_done: { ...V1, done_at: "x" } });
    assert.equal(jobStatusFromVisits(certo as never, [visit()] as never), null);
  });
});

describe("followActiveVisit (servidor)", () => {
  it("visita nova num job em Final review: Scheduled, histórico status_changed e Zendesk", async () => {
    const t = montar(job(), [visit()]);
    const r = await followActiveVisit(t.fake.client, "j9705", { userName: "Ops", syncZendesk: t.syncZendesk });
    assert.equal(r.ok && r.followed, true);
    assert.equal(t.job().status, "scheduled");
    assert.equal(t.job().scheduled_date, "2026-10-23");
    assert.equal((t.job().primary_visit_done as Row).scheduled_date, "2026-10-20");
    assert.deepEqual(t.statusLog(), ["final_check→scheduled"]);
    assert.deepEqual(t.zendesk, ["j9705"]);
  });

  it("job pago (Completed) ganha visita: volta ao ciclo e o pagamento fica igual", async () => {
    const pago = job({ status: "completed", customer_final_paid: true, customer_deposit_paid: true });
    const t = montar(pago, [visit()], { invoices: [{ id: "inv-1", status: "paid", amount_paid: 900 }] });
    await followActiveVisit(t.fake.client, "j9705", { syncZendesk: t.syncZendesk });
    assert.equal(t.job().status, "scheduled");
    assert.equal(t.job().customer_final_paid, true);
    assert.equal(t.job().customer_deposit_paid, true);
    assert.equal(t.job().invoice_id, "inv-1");
    assert.equal((t.fake.tabelas.invoices[0] as Row).status, "paid");
    assert.equal(t.fake.escritas.some((e) => e.tabela === "invoices"), false);
  });

  it("rodar de novo não muda nada nem duplica o histórico", async () => {
    const t = montar(job(), [visit()]);
    await followActiveVisit(t.fake.client, "j9705", { syncZendesk: t.syncZendesk });
    const segunda = await followActiveVisit(t.fake.client, "j9705", { syncZendesk: t.syncZendesk });
    assert.deepEqual(segunda, { ok: true, followed: false });
    assert.deepEqual(t.statusLog(), ["final_check→scheduled"]);
  });

  it("a visita começou: o job vai para In progress", async () => {
    const t = montar(job({ ...visit(), id: "j9705", status: "scheduled", primary_visit_done: { ...V1, done_at: "x" } }), [visit({ status: "in_progress" })]);
    await followActiveVisit(t.fake.client, "j9705", { syncZendesk: t.syncZendesk });
    assert.equal(t.job().status, "in_progress");
    assert.deepEqual(t.statusLog(), ["scheduled→in_progress"]);
  });
});

describe("jobAfterVisitReport (relatório da visita)", () => {
  const seguindoV3 = () => job({ ...visit(), id: "j9705", status: "in_progress", primary_visit_done: { ...V1, done_at: "x" } });

  it("relatório da última visita → Final review, com histórico", async () => {
    const t = montar(seguindoV3(), [visit({ status: "completed" })]);
    const r = await jobAfterVisitReport(t.fake.client, "j9705", { id: "v3", visit_index: 3 }, { syncZendesk: t.syncZendesk });
    assert.equal(r.ok && r.kind, "finish");
    assert.equal(t.job().status, "final_check");
    assert.deepEqual(t.statusLog(), ["in_progress→final_check"]);
    assert.equal(t.job().invoice_id, "inv-1");
  });

  it("relatório com visita ainda pela frente → o job segue para ela, não para Final review", async () => {
    const t = montar(
      job({ status: "in_progress", scheduled_date: "2026-10-22", scheduled_start_at: "2026-10-22T08:00:00Z", scheduled_end_at: null, primary_visit_done: { ...V1, done_at: "x" } }),
      [visit({ id: "v2", visit_index: 2, status: "completed", scheduled_date: "2026-10-22" }), visit()],
    );
    const r = await jobAfterVisitReport(t.fake.client, "j9705", { id: "v2", visit_index: 2 }, { syncZendesk: t.syncZendesk });
    assert.equal(r.ok && r.kind, "next_visit");
    assert.equal(t.job().status, "scheduled");
    assert.equal(t.job().scheduled_date, "2026-10-23");
    assert.deepEqual(t.statusLog(), ["in_progress→scheduled"]);
  });

  it("Scheduled (seguindo a visita) com relatório da última: passa por In progress e chega em Final review", async () => {
    const t = montar(job({ ...visit(), id: "j9705", status: "scheduled", primary_visit_done: { ...V1, done_at: "x" } }), [visit({ status: "completed" })]);
    await jobAfterVisitReport(t.fake.client, "j9705", { id: "v3", visit_index: 3 }, { syncZendesk: t.syncZendesk });
    assert.equal(t.job().status, "final_check");
    assert.deepEqual(t.statusLog(), ["scheduled→in_progress", "in_progress→final_check"]);
  });
});
