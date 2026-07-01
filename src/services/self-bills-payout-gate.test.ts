import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isJobApprovedForSelfBillPayout,
  jobContributesToSelfBillPayout,
  selfBillJobPayoutStateLabel,
} from "./self-bills";

describe("isJobApprovedForSelfBillPayout", () => {
  it("approves awaiting_payment and completed only", () => {
    assert.equal(isJobApprovedForSelfBillPayout({ status: "awaiting_payment", deleted_at: null }), true);
    assert.equal(isJobApprovedForSelfBillPayout({ status: "completed", deleted_at: null }), true);
    assert.equal(isJobApprovedForSelfBillPayout({ status: "on_hold", deleted_at: null }), false);
    assert.equal(isJobApprovedForSelfBillPayout({ status: "in_progress", deleted_at: null }), false);
    assert.equal(isJobApprovedForSelfBillPayout({ status: "scheduled", deleted_at: null }), false);
  });

  it("rejects deleted and cancelled", () => {
    assert.equal(isJobApprovedForSelfBillPayout({ status: "completed", deleted_at: "2026-01-01" }), false);
    assert.equal(isJobApprovedForSelfBillPayout({ status: "cancelled", deleted_at: null }), false);
  });
});

describe("jobContributesToSelfBillPayout", () => {
  it("excludes on_hold from payout totals", () => {
    assert.equal(
      jobContributesToSelfBillPayout({
        status: "on_hold",
        deleted_at: null,
        partner_cancelled_at: null,
      }),
      false,
    );
  });

  it("includes awaiting_payment", () => {
    assert.equal(
      jobContributesToSelfBillPayout({
        status: "awaiting_payment",
        deleted_at: null,
        partner_cancelled_at: null,
      }),
      true,
    );
  });
});

describe("selfBillJobPayoutStateLabel", () => {
  it("labels on hold jobs", () => {
    assert.equal(selfBillJobPayoutStateLabel({ status: "on_hold", deleted_at: null, partner_cancelled_at: null }), "On hold");
  });
});
