import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { format, startOfMonth } from "date-fns";
import { workforceSelfBillSyncMonthAnchors } from "./workforce-self-bills";

describe("workforceSelfBillSyncMonthAnchors", () => {
  it("returns only the calendar month containing real today", () => {
    const today = new Date("2026-05-27T12:00:00");
    const anchors = workforceSelfBillSyncMonthAnchors(today);
    assert.equal(anchors.length, 1);
    assert.equal(format(anchors[0]!, "yyyy-MM-dd"), format(startOfMonth(today), "yyyy-MM-dd"));
  });
});
