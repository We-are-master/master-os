import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { customerNetPaid, isRefundRow, planCardRefunds, refundNote, splitRefundAcrossLedger, stripeRefsFromNotes } from "@/lib/job-refund";

describe("job refund", () => {
  const rows = [
    { type: "customer_deposit", amount: 100, note: "Paid at booking · Stripe payment pi_3ABC" },
    { type: "customer_final", amount: 60, note: "Stripe checkout cs_live_a1B2 · RCP-2026-900" },
    { type: "partner", amount: 80, note: "payout" },
  ];

  it("soma só o que o cliente pagou, já com refund anterior", () => {
    assert.deepEqual(customerNetPaid(rows), { deposit: 100, final: 60, total: 160 });
    assert.equal(customerNetPaid([...rows, { type: "customer_final", amount: -20, note: "Refund to card re_1" }]).total, 140);
  });

  it("tira primeiro do saldo final, depois do sinal", () => {
    assert.deepEqual(splitRefundAcrossLedger(rows, 50), [{ type: "customer_final", amount: 50 }]);
    assert.deepEqual(splitRefundAcrossLedger(rows, 90), [{ type: "customer_final", amount: 60 }, { type: "customer_deposit", amount: 30 }]);
  });

  it("recusa refund maior que o pago ou sem valor", () => {
    assert.deepEqual(splitRefundAcrossLedger(rows, 160.01), []);
    assert.deepEqual(splitRefundAcrossLedger(rows, 0), []);
  });

  it("acha as cobranças de cartão nas notas e ignora linha de refund", () => {
    assert.deepEqual(stripeRefsFromNotes([...rows, { type: "customer_final", amount: -10, note: "Refund to card re_1 · pi_OLD" }]), { paymentIntents: ["pi_3ABC"], checkoutSessions: ["cs_live_a1B2"] });
  });

  it("reparte entre cobranças e devolve null quando o cartão não cobre", () => {
    const charges = [{ paymentIntent: "pi_b", refundablePence: 6000 }, { paymentIntent: "pi_a", refundablePence: 10000 }];
    assert.deepEqual(planCardRefunds(charges, 9000), [{ paymentIntent: "pi_b", pence: 6000 }, { paymentIntent: "pi_a", pence: 3000 }]);
    assert.equal(planCardRefunds(charges, 16001), null);
  });

  it("nota e marcação da linha de refund", () => {
    const note = refundNote({ method: "stripe", reason: "Job cancelled", stripeRefundId: "re_9", invoiceRef: "RCP-2026-900" });
    assert.equal(note, "Refund to card re_9 · RCP-2026-900 · Job cancelled");
    assert.equal(isRefundRow({ amount: -5, note }), true);
    assert.equal(isRefundRow({ amount: 5, note }), false);
  });
});
