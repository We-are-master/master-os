/**
 * A linha da visita no self-bill do parceiro (dono, 22/10/2026): nasce com a
 * visita, planejada, com o custo combinado; o Done põe o valor final na MESMA
 * linha; cancelar ou apagar tira; remarcar para outra quinzena move.
 *
 * Caso real: JOB-9705 V3, TM Handyman, £35, 23/10, quinzena 12 a 25/10.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { workPeriodForJobStartYmd } from "@/lib/partner-payout-schedule";
import {
  jobShareOfVisitSelfBill,
  plannedVisitLines,
  visitCountsForPartnerPayout,
  visitSelfBillAnchorYmd,
} from "@/lib/job-visit-rollup";
import type { JobVisit } from "@/types/database";

/** A cadência da organização (Setup): quinzenal, pagamento na sexta. */
const TERMS = "Every 2 weeks on Friday";
const REF = "2026-06-12";
const SB_TM = "sb-tm-12-25-oct";

const V3 = {
  id: "59ada91c-76d2-464c-922d-9cc465bf3d08",
  job_id: "99e489e2-f86d-45fb-a6d4-005af5f95fa6",
  visit_index: 3,
  partner_id: "p-tm",
  partner_name: "TM Handyman",
  scheduled_date: "2026-10-23",
  status: "scheduled",
  client_price: 0,
  partner_cost: 35,
  materials_cost: 0,
  completed_at: null,
  deleted_at: null,
  self_bill_id: SB_TM,
  created_at: "",
  updated_at: "",
} as unknown as JobVisit;

const quinzena = (v: Pick<JobVisit, "scheduled_date" | "completed_at">) => {
  const ymd = visitSelfBillAnchorYmd(v);
  const p = ymd ? workPeriodForJobStartYmd(ymd, TERMS, REF) : null;
  return p ? `${p.periodStartYmd}..${p.periodEndYmd}` : null;
};

describe("JOB-9705 V3 no self-bill da TM", () => {
  it("nasce na quinzena da TM de 12 a 25/10, pelo dia marcado", () => {
    assert.equal(visitSelfBillAnchorYmd(V3), "2026-10-23");
    assert.equal(quinzena(V3), "2026-10-12..2026-10-25");
  });

  it("antes do Done a linha é planejada: £35, fora do valor a pagar", () => {
    assert.deepEqual(plannedVisitLines([V3]), [
      { visitId: V3.id, jobId: V3.job_id, visitIndex: 3, scheduledDate: "2026-10-23", amount: 35 },
    ]);
    assert.equal(visitCountsForPartnerPayout(V3), false);
    assert.deepEqual(jobShareOfVisitSelfBill([V3], SB_TM), { labour: 0, materials: 0, gross: 0, pending: 35, visitIndexes: [3] });
  });

  it("o Done atualiza a MESMA linha com o valor final (Fixed £50), sem criar outra", () => {
    const feita = { ...V3, status: "completed", partner_cost: 50, completed_at: "2026-10-23T10:00:00Z" } as JobVisit;
    assert.deepEqual(plannedVisitLines([feita]), []);
    assert.equal(visitCountsForPartnerPayout(feita), true);
    assert.equal(feita.self_bill_id, SB_TM);
    assert.equal(quinzena(feita), "2026-10-12..2026-10-25");
    assert.deepEqual(jobShareOfVisitSelfBill([feita], SB_TM), { labour: 50, materials: 0, gross: 50, pending: 0, visitIndexes: [3] });
  });

  it("remarcar para 28/10 move a linha para a quinzena seguinte", () => {
    assert.equal(quinzena({ ...V3, scheduled_date: "2026-10-28" }), "2026-10-26..2026-11-08");
  });

  it("feita depois do corte cai na quinzena em que foi feita (dia de Londres)", () => {
    // O horário de verão acaba em 25/10: 23:30 UTC ainda é 25/10 em Londres.
    assert.equal(visitSelfBillAnchorYmd({ scheduled_date: "2026-10-23", completed_at: "2026-10-25T23:30:00Z" }), "2026-10-25");
    assert.equal(visitSelfBillAnchorYmd({ scheduled_date: "2026-10-23", completed_at: "2026-10-26T00:30:00Z" }), "2026-10-26");
    assert.equal(quinzena({ scheduled_date: "2026-10-23", completed_at: "2026-10-26T09:00:00Z" }), "2026-10-26..2026-11-08");
  });

  it("cancelada ou apagada sai: nem planejada, nem a pagar", () => {
    for (const v of [{ ...V3, status: "cancelled" }, { ...V3, deleted_at: "2026-10-22T00:00:00Z" }] as JobVisit[]) {
      assert.deepEqual(plannedVisitLines([v]), []);
      assert.equal(visitCountsForPartnerPayout(v), false);
      assert.equal(jobShareOfVisitSelfBill([v], SB_TM).pending, 0);
    }
  });

  it("sem data válida não tem quinzena (não liga)", () => {
    assert.equal(visitSelfBillAnchorYmd({ scheduled_date: null }), null);
    assert.equal(visitSelfBillAnchorYmd({ scheduled_date: "23/10/2026" }), null);
  });
});
