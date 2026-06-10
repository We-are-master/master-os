import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cashflowSlicesForSelfBill,
  selfBillEffectiveDueYmd,
  selfBillIsInstallmentDueForWisePay,
  selfBillWisePayAmount,
  validateInstallmentsSum,
} from "@/lib/self-bill-payment-plan";
import type { SelfBill, SelfBillPaymentInstallment } from "@/types/database";

function sb(overrides: Partial<SelfBill> = {}): SelfBill {
  return {
    id: "sb-1",
    reference: "SB-2026-001",
    partner_name: "Partner Ltd",
    period: "2026-03",
    jobs_count: 2,
    job_value: 800,
    materials: 0,
    commission: 0,
    net_payout: 800,
    status: "ready_to_pay",
    created_at: "2026-01-01T00:00:00Z",
    payment_plan_active: true,
    week_end: "2026-03-09",
    ...overrides,
  };
}

function inst(
  seq: number,
  amount: number,
  due: string,
  status: SelfBillPaymentInstallment["status"] = "pending",
): SelfBillPaymentInstallment {
  return {
    id: `inst-${seq}`,
    self_bill_id: "sb-1",
    sequence: seq,
    amount,
    due_date: due,
    status,
    created_at: "2026-01-01T00:00:00Z",
  };
}

describe("self-bill payment plan helpers", () => {
  it("effective due uses next open installment", () => {
    const installments = [
      inst(1, 200, "2026-05-01", "paid"),
      inst(2, 200, "2026-07-12", "pending"),
      inst(3, 400, "2026-08-12", "pending"),
    ];
    assert.equal(
      selfBillEffectiveDueYmd(sb(), installments, { orgStandardTerms: "Every 2 weeks on Friday" }),
      "2026-07-12",
    );
  });

  it("cashflow buckets use pending installment due dates", () => {
    const installments = [
      inst(1, 200, "2026-06-12"),
      inst(2, 200, "2026-07-12"),
      inst(3, 400, "2026-08-12"),
    ];
    const slices = cashflowSlicesForSelfBill(sb(), installments);
    assert.equal(slices.length, 3);
    assert.equal(slices[0]!.dueYmd, "2026-06-12");
    assert.equal(slices[0]!.amount, 200);
  });

  it("wise pay uses next installment amount when plan active", () => {
    const installments = [
      inst(1, 200, "2026-06-12", "paid"),
      inst(2, 300, "2026-07-10"),
      inst(3, 300, "2026-08-07"),
    ];
    assert.equal(selfBillWisePayAmount(sb(), installments, 800), 300);
    assert.equal(selfBillIsInstallmentDueForWisePay(sb(), installments, "2026-07-09"), false);
    assert.equal(selfBillIsInstallmentDueForWisePay(sb(), installments, "2026-07-10"), true);
  });

  it("validates installment sum within tolerance", () => {
    assert.equal(
      validateInstallmentsSum(800, [
        { amount: 200, due_date: "2026-06-01" },
        { amount: 600, due_date: "2026-07-01" },
      ]),
      true,
    );
    assert.equal(validateInstallmentsSum(800, [{ amount: 400, due_date: "2026-06-01" }]), false);
  });
});
