import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { invoiceIdsToCheckForOverdue, jobPaymentDetail, jobPaymentState, vencimentoDaFatura } from "@/lib/job-payment-badge";

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

  it("não pago dentro do prazo, ou sem fatura, é Unpaid", () => {
    assert.equal(jobPaymentState({ finance_status: "unpaid", invoice_id: "inv-ok" }, overdue), "unpaid");
    assert.equal(jobPaymentState({ finance_status: "unpaid" }, overdue), "unpaid");
    assert.equal(jobPaymentState({}, none), "unpaid");
  });

  it("cartão recusado com nova tentativa marcada é Retry scheduled, mesmo vencido", () => {
    assert.equal(
      jobPaymentState({ finance_status: "partial", invoice_id: "inv-late", card_charge_status: "refused", card_retry_at: "2026-10-24T09:00:00Z" }, overdue),
      "card_declined",
    );
  });

  it("cartão recusado sem nova tentativa é Payment failed", () => {
    assert.equal(jobPaymentState({ finance_status: "partial", card_charge_status: "refused", card_retry_at: null }, none), "card_failed");
  });

  it("banco pedindo confirmação é Action required", () => {
    assert.equal(jobPaymentState({ finance_status: "partial", card_charge_status: "requires_action" }, none), "bank_check");
  });

  it("cartão recusado não importa depois de pago", () => {
    assert.equal(jobPaymentState({ finance_status: "paid", card_charge_status: "refused" }, none), "paid");
  });
});

describe("jobPaymentDetail", () => {
  const hoje = "2026-10-21";

  it("Part paid mostra quanto entrou, o que falta, a fatura e o vencimento", () => {
    const d = jobPaymentDetail("partial", {}, { billable: 144, paid: 72, invoice: { reference: "RCP-2026-971", dueDate: "2026-10-23" }, todayYmd: hoje });
    assert.deepEqual(d.rows, [
      { label: "Paid", value: "£72.00 of £144.00" },
      { label: "Left to pay", value: "£72.00" },
      { label: "Invoice", value: "RCP-2026-971" },
      { label: "Due", value: "Fri 23 Oct" },
    ]);
  });

  it("Overdue conta os dias de atraso e diz o que fazer", () => {
    const d = jobPaymentDetail("overdue", {}, { billable: 100, paid: 0, invoice: { reference: "INV-1", dueDate: "2026-10-16" }, todayYmd: hoje });
    assert.equal(d.rows.at(-1)?.value, "Fri 16 Oct · 5 days late");
    assert.equal(d.headline, "An outstanding balance is past its due date.");
  });

  it("Retry scheduled mostra motivo, tentativa e a próxima", () => {
    const d = jobPaymentDetail(
      "card_declined",
      { card_retry_count: 1, card_refused_reason: "Insufficient funds", card_retry_at: "2026-10-24T09:00:00Z" },
      { billable: 144, paid: 72, todayYmd: hoje },
    );
    assert.deepEqual(d.rows.slice(2), [
      { label: "Reason", value: "Insufficient funds" },
      { label: "Attempt", value: "2 of 4" },
      { label: "Next attempt", value: "Sat 24 Oct" },
    ]);
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

describe("vencimentoDaFatura", () => {
  it("diz quantos dias passou, se vence hoje, ou quantos faltam", () => {
    assert.deepEqual(vencimentoDaFatura("2026-10-13", "2026-10-21"), { date: "Tue 13 Oct", note: "8 days late", late: true });
    assert.deepEqual(vencimentoDaFatura("2026-10-21", "2026-10-21"), { date: "Wed 21 Oct", note: "Due today", late: false });
    assert.deepEqual(vencimentoDaFatura("2026-10-23", "2026-10-21"), { date: "Fri 23 Oct", note: "In 2 days", late: false });
    assert.equal(vencimentoDaFatura(null, "2026-10-21"), null);
  });
});
