import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canDraftSelfBillForJob,
  canLinkJobToSelfBill,
} from "./self-bills";

describe("canDraftSelfBillForJob", () => {
  it("allows draft when partner and schedule exist without completed_date", () => {
    assert.equal(
      canDraftSelfBillForJob({
        partner_id: "p1",
        scheduled_date: "2026-06-09",
        scheduled_start_at: "2026-06-09T13:00:00Z",
      }),
      true,
    );
  });

  it("rejects without partner", () => {
    assert.equal(
      canDraftSelfBillForJob({ partner_id: null, scheduled_date: "2026-06-09" }),
      false,
    );
  });
});

describe("canLinkJobToSelfBill", () => {
  it("still requires completed_date for finalize link", () => {
    assert.equal(
      canLinkJobToSelfBill({
        scheduled_date: "2026-06-09",
        completed_date: undefined,
      }),
      false,
    );
    assert.equal(
      canLinkJobToSelfBill({
        scheduled_date: "2026-06-09",
        completed_date: "2026-06-09",
      }),
      true,
    );
  });
});
