import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dueDateIsoForDueOnReceiptOneOff,
  dueDateIsoForJobAccountTerms,
  resolveJobScheduleInstant,
  shouldUseDueOnReceiptOneOffRule,
} from "./job-invoice-due-anchor";

const ORG_CTX = {
  orgStandardTerms: "Every 2 weeks on Friday",
  orgReferenceYmd: "2026-06-12",
};

describe("resolveJobScheduleInstant", () => {
  it("prefers scheduled_start_at over scheduled_date", () => {
    const d = resolveJobScheduleInstant({
      scheduled_start_at: "2026-08-15T08:00:00+00:00",
      scheduled_date: "2026-08-20",
    });
    assert.ok(d);
    assert.equal(d!.toISOString().slice(0, 10), "2026-08-15");
  });

  it("falls back to scheduled_date at local noon", () => {
    const d = resolveJobScheduleInstant({ scheduled_date: "2026-08-15" });
    assert.ok(d);
    assert.equal(d!.getHours(), 12);
  });
});

describe("dueDateIsoForDueOnReceiptOneOff", () => {
  it("JOB-9295: schedule 15 Aug + 72h → 18 Aug", () => {
    const anchor = new Date("2026-08-15T08:00:00+00:00");
    assert.equal(dueDateIsoForDueOnReceiptOneOff(anchor), "2026-08-18");
  });
});

describe("dueDateIsoForJobAccountTerms", () => {
  it("one-off Due on Receipt uses schedule anchor + 72h", () => {
    const schedule = new Date("2026-08-15T12:00:00");
    const due = dueDateIsoForJobAccountTerms(new Date(), "Due on Receipt", ORG_CTX, {
      jobKind: "one_off",
      scheduleAnchor: schedule,
    });
    assert.equal(due, "2026-08-18");
  });

  it("recurring Due on Receipt keeps generic terms path without schedule rule", () => {
    const due = dueDateIsoForJobAccountTerms(
      new Date("2026-06-15T12:00:00"),
      "Due on Receipt",
      ORG_CTX,
      { jobKind: "recurring", scheduleAnchor: new Date("2026-08-15T12:00:00") },
    );
    assert.equal(due, "2026-06-18");
  });
});

describe("shouldUseDueOnReceiptOneOffRule", () => {
  it("true only for one_off + Due on Receipt", () => {
    assert.equal(shouldUseDueOnReceiptOneOffRule("Due on Receipt", "one_off"), true);
    assert.equal(shouldUseDueOnReceiptOneOffRule("Due on Receipt", "recurring"), false);
    assert.equal(shouldUseDueOnReceiptOneOffRule("Net 30", "one_off"), false);
  });
});
