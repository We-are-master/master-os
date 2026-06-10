import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  accrueMonthlyFixedPayToDate,
  countWorkforceCalendarPayableDays,
  prorateMonthlyFixedPay,
} from "./workforce-pay-schedule";

describe("accrueMonthlyFixedPayToDate", () => {
  const periodStart = "2026-06-01";
  const periodEnd = "2026-06-30";
  const monthly = 3100;

  it("grows through the month for mid-month join", () => {
    const start = "2026-06-10";
    const day15 = accrueMonthlyFixedPayToDate(monthly, periodStart, periodEnd, "2026-06-15", start);
    const day28 = accrueMonthlyFixedPayToDate(monthly, periodStart, periodEnd, "2026-06-28", start);
    const full = prorateMonthlyFixedPay(monthly, periodStart, periodEnd, start);
    assert.ok(day15 > 0);
    assert.ok(day28 > day15);
    assert.equal(accrueMonthlyFixedPayToDate(monthly, periodStart, periodEnd, periodEnd, start), full);
  });

  it("returns zero before workforce start", () => {
    assert.equal(
      accrueMonthlyFixedPayToDate(monthly, periodStart, periodEnd, "2026-06-09", "2026-06-10"),
      0,
    );
  });

  it("accrues full month when start is on period start", () => {
    const mid = accrueMonthlyFixedPayToDate(monthly, periodStart, periodEnd, "2026-06-15", periodStart);
    const end = accrueMonthlyFixedPayToDate(monthly, periodStart, periodEnd, periodEnd, periodStart);
    assert.ok(mid < end);
    assert.equal(end, monthly);
  });
});

describe("countWorkforceCalendarPayableDays — Isabella (start 25 Jun)", () => {
  const periodStart = "2026-06-01";
  const periodEnd = "2026-06-30";
  const start = "2026-06-25";
  const monthly = 3100;

  it("counts 2 payable days through 26 Jun", () => {
    const { payableDays, daysOffInRange } = countWorkforceCalendarPayableDays(
      periodStart,
      periodEnd,
      "2026-06-26",
      start,
      [],
    );
    assert.equal(payableDays, 2);
    assert.deepEqual(daysOffInRange, []);
    const fixed = accrueMonthlyFixedPayToDate(monthly, periodStart, periodEnd, "2026-06-26", start, []);
    assert.equal(fixed, Math.round(monthly * (2 / 30) * 100) / 100);
  });

  it("counts 6 payable days through month end", () => {
    const { payableDays } = countWorkforceCalendarPayableDays(
      periodStart,
      periodEnd,
      "2026-06-30",
      start,
      [],
    );
    assert.equal(payableDays, 6);
    const fixed = accrueMonthlyFixedPayToDate(monthly, periodStart, periodEnd, periodEnd, start, []);
    assert.equal(fixed, Math.round(monthly * (6 / 30) * 100) / 100);
  });

  it("deducts a day off inside the range", () => {
    const { payableDays, daysOffInRange } = countWorkforceCalendarPayableDays(
      periodStart,
      periodEnd,
      "2026-06-26",
      start,
      ["2026-06-26"],
    );
    assert.equal(payableDays, 1);
    assert.deepEqual(daysOffInRange, ["2026-06-26"]);
    const fixed = accrueMonthlyFixedPayToDate(monthly, periodStart, periodEnd, "2026-06-26", start, [
      "2026-06-26",
    ]);
    assert.equal(fixed, Math.round(monthly * (1 / 30) * 100) / 100);
  });

  it("ignores days off outside the effective range", () => {
    const { payableDays, daysOffInRange } = countWorkforceCalendarPayableDays(
      periodStart,
      periodEnd,
      "2026-06-26",
      start,
      ["2026-06-20", "2026-07-01"],
    );
    assert.equal(payableDays, 2);
    assert.deepEqual(daysOffInRange, []);
  });
});
