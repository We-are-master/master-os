import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeSelfBillAmountDue } from "@/lib/billing-selfbill-actions";
import type { SelfBillPayoutLine } from "@/services/self-bills";
import type { Job, SelfBill } from "@/types/database";

/**
 * O valor que sai pelo Wise nasce das LINHAS, nunca de `net_payout`.
 *
 * A primeira versão do dinheiro de visita fazia `net_payout − Σ(linhas de
 * job)` para trazer o que o PDF promete a mais. Isso virava `net_payout` em
 * piso do pagamento: documento com total velho passava a pagar a diferença em
 * silêncio. Estes testes existem para isso não voltar.
 */

function bill(over: Partial<SelfBill> = {}): SelfBill {
  return {
    bill_origin: "partner",
    status: "ready_to_pay",
    net_payout: 0,
    ...over,
  } as unknown as SelfBill;
}

function job(over: Partial<Job>): Job {
  return {
    id: "j1",
    reference: "JOB-0001",
    status: "completed",
    partner_cost: 0,
    materials_cost: 0,
    deleted_at: null,
    partner_cancelled_at: null,
    partner_cancellation_compensation_gbp: null,
    cancellation_fee_partner_gbp: null,
    partner_cancellation_fee: null,
    ...over,
  } as unknown as Job;
}

function visita(labour: number, materials = 0, id = "v1"): SelfBillPayoutLine {
  return { kind: "visit", id, jobId: "j1", visitIndex: 2, labour, materials };
}

describe("self-bill: dinheiro de visita", () => {
  it("soma a visita por cima das linhas de job", () => {
    const jobs = [job({ id: "a", partner_cost: 200 })];
    const due = computeSelfBillAmountDue(bill({ net_payout: 270 }), jobs as never, {}, null, [visita(70)]);
    assert.equal(due, 270);
  });

  it("documento só de visita vale as visitas dele, não o net_payout", () => {
    const due = computeSelfBillAmountDue(bill({ net_payout: 999 }), [], {}, null, [
      visita(30, 0, "v1"),
      visita(15, 5, "v2"),
    ]);
    assert.equal(due, 50);
  });

  it("net_payout inflado não vira pagamento", () => {
    // O documento promete £900, as linhas justificam £200. Paga o que as
    // linhas justificam: `net_payout` velho não pode puxar dinheiro.
    const jobs = [job({ id: "a", partner_cost: 200 })];
    const due = computeSelfBillAmountDue(bill({ net_payout: 900 }), jobs as never, {}, null, []);
    assert.equal(due, 200);
  });

  it("o que o parceiro já recebeu sai da conta, e a visita não repõe", () => {
    const jobs = [job({ id: "a", partner_cost: 200 })];
    const due = computeSelfBillAmountDue(bill({ net_payout: 270 }), jobs as never, { a: 50 }, null, [visita(70)]);
    assert.equal(due, 220);
  });

  it("documento anulado não paga, nem com visita", () => {
    const due = computeSelfBillAmountDue(
      bill({ status: "payout_cancelled", net_payout: 70 }),
      [],
      {},
      null,
      [visita(70)],
    );
    assert.equal(due, 0);
  });

  it("sem visitas informadas, cai nas linhas de job (menor que o PDF, nunca maior)", () => {
    const jobs = [job({ id: "a", partner_cost: 200 })];
    const due = computeSelfBillAmountDue(bill({ net_payout: 270 }), jobs as never, {});
    assert.equal(due, 200);
  });
});
