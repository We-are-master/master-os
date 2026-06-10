import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computePartnerRatingFromFeedback,
  feedbackEventPoints,
  partnerRatingBreakdown,
  PARTNER_RATING_MAX,
} from "@/lib/partner-rating";

describe("partner rating feedback", () => {
  it("starts at 5 with no events", () => {
    assert.equal(computePartnerRatingFromFeedback([]), PARTNER_RATING_MAX);
  });

  it("deducts 0.25 per complaint", () => {
    const rating = computePartnerRatingFromFeedback([
      { kind: "complaint", source: "job_on_hold", jobStatus: "on_hold" },
    ]);
    assert.equal(rating, 4.8);
  });

  it("deducts 0.25 when complaint job completed", () => {
    const rating = computePartnerRatingFromFeedback([
      { kind: "complaint", source: "job_on_hold", jobStatus: "completed" },
    ]);
    assert.equal(rating, 4.8);
  });

  it("adds 0.25 per praise capped at 5", () => {
    const events = Array.from({ length: 10 }, () => ({
      kind: "praise" as const,
      source: "manual" as const,
    }));
    assert.equal(computePartnerRatingFromFeedback(events), PARTNER_RATING_MAX);
  });

  it("balances complaints and praise", () => {
    const breakdown = partnerRatingBreakdown([
      { kind: "complaint", source: "job_on_hold", jobStatus: "on_hold" },
      { kind: "praise", source: "customer_review" },
      { kind: "praise", source: "manual" },
    ]);
    assert.equal(breakdown.rating, PARTNER_RATING_MAX);
    assert.equal(breakdown.complaintCount, 1);
    assert.equal(breakdown.praiseCount, 2);
    assert.equal(breakdown.pointsLost, 0.25);
    assert.equal(breakdown.pointsGained, 0.5);
  });

  it("feedbackEventPoints returns signed values", () => {
    assert.equal(
      feedbackEventPoints({ kind: "complaint", source: "job_on_hold", jobStatus: "cancelled" }),
      -0.25,
    );
    assert.equal(feedbackEventPoints({ kind: "praise", source: "manual" }), 0.25);
  });
});
