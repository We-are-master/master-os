import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  selfBillWorkWeekBounds,
  selfBillWorkWeekInPeriod,
  ymdInBounds,
  ymdRangesOverlap,
} from "./billing-standalone-period";
import { selfBillPayWorkPeriodInPeriod } from "./billing-standalone-period";
import { workPeriodBoundsForPayoutFriday } from "./partner-payout-schedule";

describe("ymdRangesOverlap", () => {
  it("detects overlapping ranges", () => {
    assert.equal(ymdRangesOverlap("2026-06-02", "2026-06-08", "2026-06-01", "2026-06-03"), true);
    assert.equal(ymdRangesOverlap("2026-06-02", "2026-06-08", "2026-06-09", "2026-06-15"), false);
  });
});

describe("selfBillWorkWeekInPeriod", () => {
  const thisWeek = { from: "2026-06-01", to: "2026-06-07" };

  it("includes W23 self-bill when due_date is next Friday (12 Jun)", () => {
    const sb = {
      week_start: "2026-06-01",
      week_end: "2026-06-07",
      week_label: "2026-W23",
      due_date: "2026-06-12",
    };
    assert.equal(selfBillWorkWeekInPeriod(sb, thisWeek), true);
    assert.equal(ymdInBounds("2026-06-12", thisWeek), false);
  });

  it("resolves bounds from week_label when week_start is missing", () => {
    const bounds = selfBillWorkWeekBounds({ week_label: "2026-W23" });
    assert.ok(bounds);
    assert.equal(bounds!.from, "2026-06-01");
    assert.equal(bounds!.to, "2026-06-07");
    assert.equal(selfBillWorkWeekInPeriod({ week_label: "2026-W23" }, thisWeek), true);
  });

  it("excludes self-bills from other work weeks", () => {
    const sb = {
      week_start: "2026-05-18",
      week_end: "2026-05-24",
      week_label: "2026-W21",
    };
    assert.equal(selfBillWorkWeekInPeriod(sb, thisWeek), false);
  });
});

describe("selfBillPayWorkPeriodInPeriod", () => {
  const payPeriod = workPeriodBoundsForPayoutFriday("2026-06-12");

  it("includes self-bill with due 12 Jun when filter overlaps pay work period", () => {
    const sb = { due_date: "2026-06-12", week_start: "2026-05-25", week_end: "2026-05-31" };
    assert.equal(
      selfBillPayWorkPeriodInPeriod(sb, { from: payPeriod.periodStartYmd, to: payPeriod.periodEndYmd }),
      true,
    );
  });

  it("excludes self-bill from another pay period", () => {
    const sb = { due_date: "2026-06-26", week_start: "2026-06-08", week_end: "2026-06-14" };
    assert.equal(
      selfBillPayWorkPeriodInPeriod(sb, { from: payPeriod.periodStartYmd, to: payPeriod.periodEndYmd }),
      false,
    );
  });

  it("includes internal workforce by due_date in period", () => {
    const sb = {
      bill_origin: "internal",
      due_date: "2026-07-05",
      week_start: "2026-06-01",
      week_end: "2026-06-30",
      status: "accumulating",
    };
    assert.equal(selfBillPayWorkPeriodInPeriod(sb, { from: "2026-07-01", to: "2026-07-10" }), true);
  });

  it("includes accumulating internal when due_date is after period end but on/after period start", () => {
    const sb = {
      bill_origin: "internal",
      due_date: "2026-07-05",
      week_start: "2026-06-01",
      week_end: "2026-06-30",
      status: "accumulating",
    };
    assert.equal(selfBillPayWorkPeriodInPeriod(sb, { from: "2026-06-15", to: "2026-06-20" }), true);
  });
});
