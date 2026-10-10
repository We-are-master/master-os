import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { daysOverdue, nextReminderStage, reminderCopy } from "./invoice-overdue-reminders";

describe("overdue invoice reminders: 1, 3, 4 days friendly, 7 days final", () => {
  it("counts calendar days overdue", () => {
    assert.equal(daysOverdue("2026-10-16", "2026-10-17"), 1);
    assert.equal(daysOverdue("2026-10-16", "2026-10-16"), 0);
  });
  it("sends each stage once, in order", () => {
    assert.equal(nextReminderStage(0, 0), null);
    assert.equal(nextReminderStage(0, 1), 1);
    assert.equal(nextReminderStage(1, 2), null);
    assert.equal(nextReminderStage(1, 3), 2);
    assert.equal(nextReminderStage(2, 4), 3);
    assert.equal(nextReminderStage(3, 6), null);
    assert.equal(nextReminderStage(3, 7), 4);
    assert.equal(nextReminderStage(4, 30), null);
  });
  it("catches up one stage at a time after a gap", () => {
    assert.equal(nextReminderStage(0, 10), 1);
    assert.equal(nextReminderStage(1, 10), 2);
  });
  it("last one is the final reminder", () => {
    const c = reminderCopy(4, { name: "Maryna", reference: "INV-1", amount: "£198.00", dueLabel: "16 Oct", jobLabel: "JOB-1", payUrl: null });
    assert.equal(c.final, true);
    assert.match(c.subject, /^Final reminder/);
    assert.match(reminderCopy(1, { name: "x", reference: "INV-1", amount: "£1", dueLabel: "d", jobLabel: "j", payUrl: null }).subject, /^Friendly reminder/);
  });
});
