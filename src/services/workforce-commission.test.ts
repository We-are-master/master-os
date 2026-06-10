import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ownerJobEligibleForWorkforceCommission } from "./workforce-commission";

describe("ownerJobEligibleForWorkforceCommission", () => {
  it("includes completed active jobs", () => {
    assert.equal(ownerJobEligibleForWorkforceCommission({ status: "completed", deleted_at: null }), true);
  });

  it("excludes cancelled jobs", () => {
    assert.equal(ownerJobEligibleForWorkforceCommission({ status: "cancelled", deleted_at: null }), false);
  });

  it("excludes deleted jobs", () => {
    assert.equal(
      ownerJobEligibleForWorkforceCommission({ status: "completed", deleted_at: "2026-06-01T00:00:00Z" }),
      false,
    );
    assert.equal(ownerJobEligibleForWorkforceCommission({ status: "deleted", deleted_at: null }), false);
  });
});
