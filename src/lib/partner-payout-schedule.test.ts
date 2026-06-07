import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ORG_PARTNER_PAYOUT_STANDARD_TERMS,
  computePartnerSelfBillDueIso,
  workPeriodBoundsForPayoutFriday,
  workPeriodForJobStartYmd,
} from "./partner-payout-schedule";
import { getWeekBoundsForDate } from "./self-bill-period";
import { jobSelfBillPeriodAnchorYmd, resolveJobSelfBillWeekAnchor } from "@/services/self-bills";

describe("workPeriodBoundsForPayoutFriday", () => {
  it("maps pay 12 Jun 2026 to work 25 May – 7 Jun", () => {
    const period = workPeriodBoundsForPayoutFriday("2026-06-12");
    assert.equal(period.periodStartYmd, "2026-05-25");
    assert.equal(period.periodEndYmd, "2026-06-07");
    assert.equal(period.payoutDueYmd, "2026-06-12");
  });

  it("maps pay 26 Jun 2026 to work 8 Jun – 21 Jun", () => {
    const period = workPeriodBoundsForPayoutFriday("2026-06-26");
    assert.equal(period.periodStartYmd, "2026-06-08");
    assert.equal(period.periodEndYmd, "2026-06-21");
  });
});

describe("workPeriodForJobStartYmd", () => {
  const terms = ORG_PARTNER_PAYOUT_STANDARD_TERMS;
  const ref = "2026-06-12";

  it("places job start 28 May in pay-12-Jun period", () => {
    const period = workPeriodForJobStartYmd("2026-05-28", terms, ref);
    assert.ok(period);
    assert.equal(period!.payoutDueYmd, "2026-06-12");
    assert.equal(period!.periodStartYmd, "2026-05-25");
    assert.equal(period!.periodEndYmd, "2026-06-07");
  });

  it("places job start 10 Jun in pay-26-Jun period", () => {
    const period = workPeriodForJobStartYmd("2026-06-10", terms, ref);
    assert.ok(period);
    assert.equal(period!.payoutDueYmd, "2026-06-26");
    assert.equal(period!.periodStartYmd, "2026-06-08");
    assert.equal(period!.periodEndYmd, "2026-06-21");
  });
});

describe("biweekly due from ISO week ends", () => {
  const terms = ORG_PARTNER_PAYOUT_STANDARD_TERMS;
  const ref = "2026-06-12";

  it("maps both weeks in the same pay period to 12 Jun", () => {
    const dueW23 = computePartnerSelfBillDueIso("2026-05-31", null, terms, ref);
    const dueW24 = computePartnerSelfBillDueIso("2026-06-07", null, terms, ref);
    assert.equal(dueW23, "2026-06-12");
    assert.equal(dueW24, "2026-06-12");
  });
});

describe("jobSelfBillPeriodAnchorYmd", () => {
  it("uses scheduled_start_at for ISO week bucket", () => {
    assert.equal(
      jobSelfBillPeriodAnchorYmd({ scheduled_start_at: "2026-06-01T09:00:00Z", scheduled_date: "2026-05-27" }),
      "2026-06-01",
    );
    const anchor = resolveJobSelfBillWeekAnchor({
      scheduled_start_at: "2026-06-01T09:00:00Z",
      scheduled_date: "2026-05-27",
    });
    assert.ok(anchor);
    const { weekStart, weekEnd, weekLabel } = getWeekBoundsForDate(anchor!);
    assert.equal(weekStart, "2026-06-01");
    assert.equal(weekEnd, "2026-06-07");
    assert.equal(weekLabel, "2026-W23");
  });
});
