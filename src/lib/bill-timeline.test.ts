import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bill } from "@/types/database";
import { amountsForDueDates, buildBillTimeline, addMonths } from "./bill-timeline";

function bill(p: Partial<Bill>): Bill {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    description: "Test",
    amount: 10,
    due_date: "2026-11-16",
    is_recurring: false,
    status: "approved",
    created_at: "",
    updated_at: "",
    ...p,
  } as Bill;
}

test("addMonths crosses the year", () => {
  assert.equal(addMonths("2026-11", 2), "2027-01");
});

test("steps set the price from a month on, overrides change one payment", () => {
  const dates = ["2026-11-16", "2026-12-16", "2027-01-16", "2027-02-16"];
  const out = amountsForDueDates(
    dates,
    [
      { fromMonth: "2027-01", amount: 1000 },
      { fromMonth: "2026-11", amount: 688 },
    ],
    { "2027-02-16": 720 },
  );
  assert.deepEqual(out, {
    "2026-11-16": 688,
    "2026-12-16": 688,
    "2027-01-16": 1000,
    "2027-02-16": 720,
  });
});

test("timeline sums the month, marks the price change and the last payment", () => {
  const s = { is_recurring: true, recurrence_interval: "monthly" as const, recurring_series_id: "a", description: "Checkatrade" };
  const rows = [
    bill({ ...s, due_date: "2026-11-16", amount: 688 }),
    bill({ ...s, due_date: "2026-12-16", amount: 688 }),
    bill({ ...s, due_date: "2027-01-11", amount: 1000 }),
    bill({ description: "Leo", due_date: "2026-11-16", amount: 300 }),
    bill({ description: "Old", due_date: "2026-11-01", amount: 5, archived_at: "2026-10-01" }),
  ];
  const t = buildBillTimeline(rows, "2026-11", 3);
  assert.deepEqual(t.months, ["2026-11", "2026-12", "2027-01"]);
  assert.equal(t.rows.length, 2);
  const ck = t.rows.find((r) => r.title === "Checkatrade")!;
  assert.deepEqual(ck.cells.map((c) => c.amount), [688, 688, 1000]);
  assert.deepEqual(ck.cells.map((c) => c.changed), [false, false, true]);
  // No end date: ongoing, so no last-payment mark.
  assert.deepEqual(ck.cells.map((c) => c.last), [false, false, false]);
  assert.deepEqual(t.totals, [988, 688, 1000]);
});

test("the timeline runs to the last bill that ends; payroll follows it", () => {
  const loan = { is_recurring: true, recurrence_interval: "monthly" as const, recurring_series_id: "l", category: "debit", description: "Loan", recurring_series_end_date: "2027-02-10" };
  const pay = { is_recurring: true, recurrence_interval: "monthly" as const, recurring_series_id: "p", category: "payroll_related", description: "Salary", recurring_series_end_date: null };
  const rows = [
    bill({ ...loan, due_date: "2026-12-10", amount: 100 }),
    bill({ ...loan, due_date: "2027-01-10", amount: 100 }),
    bill({ ...loan, due_date: "2027-02-10", amount: 100 }),
    bill({ ...pay, due_date: "2026-11-15", amount: 1300 }),
  ];
  const t = buildBillTimeline(rows, "2026-11", undefined, 1);
  assert.deepEqual(t.months, ["2026-11", "2026-12", "2027-01", "2027-02"]);
  const salary = t.rows.find((r) => r.title === "Salary")!;
  assert.equal(salary.ongoing, true);
  assert.deepEqual(salary.cells.map((c) => [c.amount, c.projected]), [[1300, false], [1300, true], [1300, true], [1300, true]]);
  assert.deepEqual(t.rows.find((r) => r.title === "Loan")!.cells.map((c) => c.last), [false, false, false, true]);
});
