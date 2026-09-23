import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { invoiceIdsToCheckForOverdue, jobPaymentState } from "@/lib/job-payment-badge";

/**
 * A coluna Payment do Jobs Management. Reserva do site nasce paga, conta B2B
 * espera a fatura, e fatura vencida tem que aparecer como Overdue mesmo com
 * parte paga.
 */
const none = new Set<string>();
const overdue = new Set(["inv-late"]);

describe("jobPaymentState", () => {
  it("job pago é Paid, mesmo com fatura na lista de vencidas", () => {
    assert.equal(jobPaymentState({ finance_status: "paid", invoice_id: "inv-late" }, overdue), "paid");
  });

  it("reserva do site que só gravou payment_status também é Paid", () => {
    assert.equal(jobPaymentState({ finance_status: null, payment_status: "paid" }, none), "paid");
  });

  it("parte paga e fatura vencida é Overdue", () => {
    assert.equal(jobPaymentState({ finance_status: "partial", invoice_id: "inv-late" }, overdue), "overdue");
  });

  it("parte paga dentro do prazo é Partial", () => {
    assert.equal(jobPaymentState({ finance_status: "partial", invoice_id: "inv-ok" }, overdue), "partial");
  });

  it("não pago com fatura vencida é Overdue", () => {
    assert.equal(jobPaymentState({ finance_status: "unpaid", invoice_id: "inv-late" }, overdue), "overdue");
  });

  it("não pago dentro do prazo, ou sem fatura, é Awaiting payment", () => {
    assert.equal(jobPaymentState({ finance_status: "unpaid", invoice_id: "inv-ok" }, overdue), "awaiting");
    assert.equal(jobPaymentState({ finance_status: "unpaid" }, overdue), "awaiting");
    assert.equal(jobPaymentState({}, none), "awaiting");
  });
});

describe("invoiceIdsToCheckForOverdue", () => {
  it("consulta só fatura de job que não está pago, sem repetir", () => {
    const ids = invoiceIdsToCheckForOverdue([
      { finance_status: "paid", invoice_id: "a" },
      { finance_status: "unpaid", invoice_id: "b" },
      { finance_status: "partial", invoice_id: "b" },
      { finance_status: "unpaid", invoice_id: null },
      { payment_status: "unpaid", invoice_id: "c" },
    ]);
    assert.deepEqual(ids, ["b", "c"]);
  });
});
