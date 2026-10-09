import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { jobSelfBillPeriodAnchorYmd } from "./self-bills";

describe("partner fortnight follows the day the job was completed", () => {
  it("uses the schedule while the job is not done", () => {
    assert.equal(jobSelfBillPeriodAnchorYmd({ scheduled_date: "2026-10-09" }), "2026-10-09");
  });
  it("uses the completion day once the partner finished, even if approved later", () => {
    assert.equal(
      jobSelfBillPeriodAnchorYmd({
        scheduled_date: "2026-10-06",
        scheduled_start_at: "2026-10-06T09:00:00Z",
        final_report: { submitted_at: "2026-10-12T15:00:00Z" },
        completed_date: "2026-10-14",
      }),
      "2026-10-12",
    );
  });
});
