import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isVisitJobRow,
  jobIdOfRow,
  jobRowHref,
  selectVisitsInRange,
  visitAsJobRow,
  visitJobsTab,
  visitMatchesJobSlot,
  type VisitWithParent,
} from "@/lib/job-visit-day-rows";
import type { Job } from "@/types/database";

function job(over: Partial<Job> = {}): Job {
  return {
    id: "job-9705",
    reference: "JOB-9705",
    title: "General Maintenance",
    status: "final_check",
    client_name: "Kate Allen",
    property_address: "13 Herne Hill, London SE24",
    partner_id: "p-primary",
    partner_name: "Primary Partner",
    scheduled_date: "2026-10-20",
    scheduled_start_at: "2026-10-20T07:00:00Z",
    scheduled_end_at: "2026-10-20T08:00:00Z",
    client_price: 900,
    partner_cost: 500,
    materials_cost: 40,
    extras_amount: 120,
    invoice_id: "inv-1",
    ...over,
  } as Job;
}

function visit(over: Partial<VisitWithParent> = {}): VisitWithParent {
  return {
    id: "59ada91c-76d2-464c-922d-9cc465bf3d08",
    job_id: "job-9705",
    visit_index: 3,
    partner_id: "p-tm",
    partner_name: "TM Handyman",
    scheduled_date: "2026-10-23",
    scheduled_start_at: "2026-10-23T07:00:00Z",
    scheduled_end_at: "2026-10-23T08:00:00Z",
    client_price: 216,
    partner_cost: 140,
    materials_cost: 0,
    status: "scheduled",
    created_at: "2026-10-19T10:00:00Z",
    updated_at: "2026-10-19T10:00:00Z",
    deleted_at: null,
    parent: job(),
    ...over,
  } as VisitWithParent;
}

describe("selectVisitsInRange: visita no dia dela", () => {
  it("JOB-9705: a V3 de 23/10 entra no dia 23 mesmo com o job em Final review dia 20", () => {
    const out = selectVisitsInRange([visit()], { from: "2026-10-23", to: "2026-10-23" });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.visit_index, 3);
  });

  it("fora do período não entra; período aberto pega tudo", () => {
    assert.equal(selectVisitsInRange([visit()], { from: "2026-10-24", to: "2026-10-30" }).length, 0);
    assert.equal(selectVisitsInRange([visit()], { from: "2026-10-01", to: "2026-10-22" }).length, 0);
    assert.equal(selectVisitsInRange([visit()], {}).length, 1);
  });

  it("só visita aberta: feita, cancelada, apagada ou sem data ficam de fora", () => {
    const rows = [
      visit({ id: "a", status: "completed" }),
      visit({ id: "b", status: "cancelled" }),
      visit({ id: "c", deleted_at: "2026-10-21T00:00:00Z" }),
      visit({ id: "d", scheduled_date: null }),
      visit({ id: "e", status: "in_progress" }),
    ];
    assert.deepEqual(selectVisitsInRange(rows, {}).map((v) => v.id), ["e"]);
  });

  it("job pai cancelado, apagado ou ausente: a visita não aparece", () => {
    const rows = [
      visit({ id: "a", parent: job({ status: "cancelled" }) }),
      visit({ id: "b", parent: job({ deleted_at: "2026-10-21T00:00:00Z" }) }),
      visit({ id: "c", parent: null }),
    ];
    assert.equal(selectVisitsInRange(rows, {}).length, 0);
  });

  it("a mesma visita duas vezes na entrada vira uma linha só", () => {
    assert.equal(selectVisitsInRange([visit(), visit()], {}).length, 1);
  });
});

describe("não duplicar quando a visita é o próprio horário do job", () => {
  // O Done da V1 copia data e janela da próxima visita para o job: a linha do job já é ela.
  const avancado = job({
    status: "scheduled",
    scheduled_date: "2026-10-23",
    scheduled_start_at: "2026-10-23T07:00:00Z",
    scheduled_end_at: "2026-10-23T08:00:00Z",
  });

  it("mesmo dia e mesma janela do job em campo: sai, a linha do job já mostra", () => {
    assert.equal(visitMatchesJobSlot(avancado, visit()), true);
    assert.equal(selectVisitsInRange([visit({ parent: avancado })], { from: "2026-10-23", to: "2026-10-23" }).length, 0);
  });

  it("mesmo instante escrito com fuso diferente ainda é o mesmo horário", () => {
    assert.equal(
      visitMatchesJobSlot(avancado, visit({ scheduled_start_at: "2026-10-23T08:00:00+01:00" })),
      true,
    );
  });

  it("mesmo dia, outra janela: são duas paradas, as duas aparecem", () => {
    const tarde = visit({ scheduled_start_at: "2026-10-23T13:00:00Z", scheduled_end_at: "2026-10-23T14:00:00Z" });
    assert.equal(visitMatchesJobSlot(avancado, tarde), false);
    assert.equal(selectVisitsInRange([{ ...tarde, parent: avancado }], {}).length, 1);
  });

  it("mesma data e horário, mas o job não está mais em campo: a visita é a única linha do dia", () => {
    const naRevisao = { ...avancado, status: "final_check" } as Job;
    assert.equal(selectVisitsInRange([visit({ parent: naRevisao })], {}).length, 1);
  });

  it("quem chama decide se a linha do job está na lista (e-mail e rota usam o próprio dia)", () => {
    const naRevisao = { ...avancado, status: "final_check" } as Job;
    const jaNaLista = new Set([naRevisao.id]);
    assert.equal(selectVisitsInRange([visit({ parent: naRevisao })], {}, (j) => jaNaLista.has(j.id)).length, 0);
  });

  it("sem horário nos dois lados, mesmo dia conta como o mesmo horário", () => {
    const semHora = job({ status: "scheduled", scheduled_date: "2026-10-23", scheduled_start_at: undefined });
    assert.equal(visitMatchesJobSlot(semHora, visit({ scheduled_start_at: null })), true);
    assert.equal(visitMatchesJobSlot(semHora, visit()), false);
  });
});

describe("visitAsJobRow: a linha com cara de job", () => {
  const row = visitAsJobRow(visit());

  it("rótulo JOB-XXXX · V3, endereço e cliente do job", () => {
    assert.equal(row.reference, "JOB-9705 · V3");
    assert.equal(row.property_address, "13 Herne Hill, London SE24");
    assert.equal(row.client_name, "Kate Allen");
  });

  it("dia, janela, parceiro e status são da visita", () => {
    assert.equal(row.scheduled_date, "2026-10-23");
    assert.equal(row.scheduled_start_at, "2026-10-23T07:00:00Z");
    assert.equal(row.partner_id, "p-tm");
    assert.equal(row.partner_name, "TM Handyman");
    assert.equal(row.status, "scheduled");
    assert.equal(visitAsJobRow(visit({ status: "in_progress" })).status, "in_progress");
  });

  it("dinheiro é só o da visita: nada de extras nem fatura do job", () => {
    assert.equal(row.client_price, 216);
    assert.equal(row.partner_cost, 140);
    assert.equal(row.materials_cost, 0);
    assert.equal(row.extras_amount, 0);
    assert.equal(row.invoice_id, undefined);
  });

  it("visita sem parceiro herda o do job", () => {
    const r = visitAsJobRow(visit({ partner_id: null, partner_name: null }));
    assert.equal(r.partner_id, "p-primary");
    assert.equal(r.partner_name, "Primary Partner");
  });

  it("clicar abre o job, na visita", () => {
    assert.equal(isVisitJobRow(row), true);
    assert.equal(jobIdOfRow(row), "job-9705");
    assert.equal(jobRowHref(row), "/jobs/job-9705?visit=59ada91c-76d2-464c-922d-9cc465bf3d08");
    assert.equal(isVisitJobRow(job()), false);
    assert.equal(jobRowHref(job()), "/jobs/job-9705");
  });

  it("aba da visita é a do status dela", () => {
    assert.equal(visitJobsTab({ status: "scheduled" }), "scheduled");
    assert.equal(visitJobsTab({ status: "in_progress" }), "in_progress");
    assert.equal(visitJobsTab({ status: "completed" }), null);
  });
});
