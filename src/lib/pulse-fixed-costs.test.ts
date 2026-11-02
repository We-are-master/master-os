import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeBillsFixedCostForPeriod, computeMonthlyBillsBurn, type PulseBillRow } from "./pulse-fixed-costs";

function serie(id: string, amount: number, dues: string[], end: string | null = dues.at(-1) ?? null): PulseBillRow[] {
  return dues.map((due_date, i) => ({
    recurring_series_end_date: end,
    id: `${id}-${i}`,
    amount,
    due_date,
    is_recurring: true,
    recurrence_interval: "monthly",
    recurring_series_id: id,
    status: "approved",
  }));
}

describe("computeMonthlyBillsBurn", () => {
  const rows = [
    ...serie("ct-now", 688, ["2026-11-16", "2026-12-14"]),
    ...serie("ct-later", 1000, ["2027-01-11", "2027-02-08"]),
    ...serie("old", 300, ["2026-08-10", "2026-09-10"]),
  ];

  it("counts only the price step running this month", () => {
    assert.equal(computeMonthlyBillsBurn(rows, new Date(2026, 10, 2)), 688);
    assert.equal(computeMonthlyBillsBurn(rows, new Date(2027, 0, 20)), 1000);
  });

  it("keeps a series whose next row is not generated yet", () => {
    const pending = serie("gen", 50, ["2026-10-28"], null);
    assert.equal(computeMonthlyBillsBurn(pending, new Date(2026, 10, 2)), 50);
  });
});

describe("computeBillsFixedCostForPeriod", () => {
  it("drops series that start after the period", () => {
    const rows = [...serie("a", 688, ["2026-11-16"]), ...serie("b", 1000, ["2027-01-11"])];
    const { total } = computeBillsFixedCostForPeriod(rows, "2026-11-01", "2026-11-30", 1);
    assert.equal(total, 688);
  });
});
