/**
 * Painel "Partner self-bill" do JOB-9705 com os dados reais de 22/10/2026:
 *  - SB-14546 (Fixfy, V1): rejected, jobs_count 0, net_payout 0; o card mostrava £340.
 *  - SB-14535 (F&V Cleaning, quinzena 12-25/10): accumulating, £1,309.66 com 9 jobs + a V2 (£140).
 *  - V3 (TM Handyman, £35): sem documento.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDeadSelfBill, selfBillHeaderSource, selfBillPanelRows } from "@/lib/job-self-bill-panel";
import type { JobVisit, SelfBill } from "@/types/database";

const SB_FIXFY = {
  id: "3f83e2ec-2716-4cf3-a61c-5e2b4d80b3ec",
  reference: "SB-14546",
  partner_name: "Fixfy",
  status: "rejected",
  jobs_count: 0,
  net_payout: 0,
} as unknown as SelfBill;

const SB_FV = {
  id: "83919054-c56d-4ffa-b20c-c30b7433a90e",
  reference: "SB-14535",
  partner_name: "F&V Cleaning",
  status: "accumulating",
  jobs_count: 9,
  net_payout: 1309.66,
} as unknown as SelfBill;

function visita(over: Partial<JobVisit>): JobVisit {
  return {
    id: "v", job_id: "99e489e2", visit_index: 2, status: "scheduled", client_price: 0, partner_cost: 0,
    materials_cost: 0, created_at: "", updated_at: "", deleted_at: null, self_bill_id: null, ...over,
  } as JobVisit;
}
const V2 = visita({ id: "5c29b4ed", visit_index: 2, partner_cost: 140, partner_name: "F&V Cleaning", self_bill_id: SB_FV.id });
const V3 = visita({ id: "59ada91c", visit_index: 3, partner_cost: 35, partner_name: "TM Handyman" });

const montar = (visits: JobVisit[]) =>
  selfBillPanelRows({ primary: SB_FIXFY, visitDocs: [SB_FV], visits, primaryJobLine: 340, primaryPartnerName: "Fixfy" });

describe("painel Partner self-bill do JOB-9705", () => {
  it("Fixfy (SB-14546 rejeitado) não aparece com £340: é 'no self-bill'", () => {
    const fixfy = montar([V2, V3])[0]!;
    assert.equal(fixfy.reference, "SB-14546");
    assert.equal(fixfy.dead, true);
    assert.equal(fixfy.thisJob, 0);
    assert.equal(fixfy.visitsLabel, "V1");
  });

  it("F&V mostra só a parte deste job (V2 £140) e a quinzena como referência (£1,309.66)", () => {
    const antes = montar([V2, V3])[1]!;
    assert.equal(antes.reference, "SB-14535");
    assert.equal(antes.partnerName, "F&V Cleaning");
    assert.equal(antes.visitsLabel, "V2");
    assert.equal(antes.fortnightTotal, 1309.66);
    // V2 ainda sem Done: está no documento, entra no pagamento depois do Done.
    assert.equal(antes.thisJob, 0);
    assert.equal(antes.pending, 140);

    const depois = montar([{ ...V2, status: "completed" }, V3])[1]!;
    assert.equal(depois.thisJob, 140);
    assert.equal(depois.pending, 0);
  });

  it("o selo do cabeçalho vem do documento vivo (F&V accumulating), não do rejeitado", () => {
    assert.deepEqual(selfBillHeaderSource(montar([V2, V3])), { kind: "live", status: "accumulating" });
  });

  it("só documentos mortos: o selo diz cancelado; nenhum documento: sem selo", () => {
    const soMorto = selfBillPanelRows({ primary: SB_FIXFY, visitDocs: [], visits: [], primaryJobLine: 340 });
    assert.deepEqual(selfBillHeaderSource(soMorto), { kind: "all_dead" });
    assert.equal(selfBillHeaderSource([]), null);
  });

  it("parceiro da V1 vivo: V1 e as visitas do mesmo parceiro somam no mesmo documento", () => {
    const vivo = { ...SB_FV, id: "sb-v1", partner_name: "Fixfy", status: "accumulating" } as unknown as SelfBill;
    const rows = selfBillPanelRows({
      primary: vivo,
      visitDocs: [vivo],
      visits: [visita({ id: "x", visit_index: 4, partner_cost: 60, status: "completed", self_bill_id: "sb-v1" })],
      primaryJobLine: 340,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.thisJob, 400);
    assert.equal(rows[0]!.visitsLabel, "V1, V4");
  });

  it("estados que não pagam", () => {
    for (const s of ["rejected", "payout_cancelled", "payout_lost", "payout_archived"]) {
      assert.equal(isDeadSelfBill({ status: s } as SelfBill), true, s);
    }
    for (const s of ["accumulating", "draft", "ready_to_pay", "paid"]) {
      assert.equal(isDeadSelfBill({ status: s } as SelfBill), false, s);
    }
  });
});
