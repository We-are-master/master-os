import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cashflowSlicesForInvoice,
  daysLateWithPlan,
  invoiceEffectiveDueYmd,
  invoiceIsDerivedOverdueWithPlan,
  nextOpenInstallment,
  pickInstallmentForExtraAllocation,
  validateInstallmentsSum,
} from "@/lib/invoice-payment-plan";
import type { Invoice, InvoicePaymentInstallment } from "@/types/database";

function inv(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    reference: "RCP-2026-001",
    client_name: "Client",
    amount: 8000,
    status: "pending",
    due_date: "2026-09-01",
    created_at: "2026-01-01T00:00:00Z",
    collection_stage: "awaiting_final",
    payment_plan_active: true,
    ...overrides,
  };
}

function inst(
  seq: number,
  amount: number,
  due: string,
  status: InvoicePaymentInstallment["status"] = "pending",
): InvoicePaymentInstallment {
  return {
    id: `inst-${seq}`,
    invoice_id: "inv-1",
    sequence: seq,
    amount,
    due_date: due,
    status,
    created_at: "2026-01-01T00:00:00Z",
  };
}

describe("invoice payment plan helpers", () => {
  it("overdue only when next open installment is past due", () => {
    const installments = [
      inst(1, 2000, "2026-05-01", "paid"),
      inst(2, 2000, "2026-07-12", "pending"),
      inst(3, 2000, "2026-08-12", "pending"),
    ];
    assert.equal(invoiceIsDerivedOverdueWithPlan(inv(), installments, "2026-06-01"), false);
    assert.equal(invoiceIsDerivedOverdueWithPlan(inv(), installments, "2026-07-13"), true);
    assert.equal(invoiceEffectiveDueYmd(inv(), installments), "2026-07-12");
  });

  it("cashflow buckets use pending installment due dates", () => {
    const installments = [
      inst(1, 2111, "2026-06-12"),
      inst(2, 2111, "2026-07-12"),
      inst(3, 2111, "2026-08-12"),
      inst(4, 2113, "2026-09-12"),
    ];
    const slices = cashflowSlicesForInvoice(inv(), installments);
    assert.equal(slices.length, 4);
    assert.equal(slices[0]!.dueYmd, "2026-06-12");
    assert.equal(slices[0]!.amount, 2111);
  });

  it("validates installment sum within tolerance", () => {
    assert.equal(validateInstallmentsSum(100, [{ amount: 50, due_date: "2026-06-01" }, { amount: 50, due_date: "2026-07-01" }]), true);
    assert.equal(validateInstallmentsSum(100, [{ amount: 40, due_date: "2026-06-01" }]), false);
  });

  it("allocates extra to nearest upcoming installment", () => {
    const installments = [
      inst(1, 2000, "2026-05-01", "paid"),
      inst(2, 2000, "2026-07-01"),
      inst(3, 2000, "2026-08-01"),
    ];
    const pick = pickInstallmentForExtraAllocation(installments, "2026-06-15");
    assert.equal(pick?.sequence, 2);
    const past = pickInstallmentForExtraAllocation(
      [inst(1, 2000, "2026-01-01", "paid"), inst(2, 2000, "2026-02-01")],
      "2026-06-01",
    );
    assert.equal(past?.sequence, 2);
  });

  it("days late from next open installment", () => {
    const installments = [inst(1, 2000, "2026-05-01", "paid"), inst(2, 2000, "2026-06-01")];
    assert.equal(daysLateWithPlan(inv(), installments, "2026-06-10"), 9);
    assert.equal(nextOpenInstallment(installments)?.sequence, 2);
  });

  it("without plan falls back to invoice due_date for overdue", () => {
    const plain = inv({ payment_plan_active: false, due_date: "2026-05-01" });
    assert.equal(invoiceIsDerivedOverdueWithPlan(plain, [], "2026-06-01"), true);
    assert.equal(invoiceEffectiveDueYmd(plain, null), "2026-05-01");
  });
});
