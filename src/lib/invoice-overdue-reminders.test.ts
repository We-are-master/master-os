import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { daysOverdue, nextReminderStage, reminderCopy } from "./invoice-overdue-reminders";

describe("overdue invoice reminders: 1, 3, 4 days friendly, 7 days final", () => {
  it("counts calendar days overdue", () => {
    assert.equal(daysOverdue("2026-10-16", "2026-10-17"), 1);
    assert.equal(daysOverdue("2026-10-16", "2026-10-16"), 0);
  });
  it("sends each stage once, in order, with the gap since the last one", () => {
    assert.equal(nextReminderStage(0, 0), null);
    assert.equal(nextReminderStage(0, 1), 1);
    assert.equal(nextReminderStage(1, 2, 1), null);
    assert.equal(nextReminderStage(1, 3, 2), 2);
    assert.equal(nextReminderStage(2, 4, 1), 3);
    assert.equal(nextReminderStage(3, 6, 2), null);
    assert.equal(nextReminderStage(3, 7, 3), 4);
    assert.equal(nextReminderStage(4, 30, 10), null);
  });
  it("an old invoice does not get one reminder a day", () => {
    assert.equal(nextReminderStage(0, 10), 1);
    assert.equal(nextReminderStage(1, 11, 1), null);
    assert.equal(nextReminderStage(1, 12, 2), 2);
    assert.equal(nextReminderStage(2, 13, 1), 3);
    assert.equal(nextReminderStage(3, 14, 1), null);
    assert.equal(nextReminderStage(3, 16, 3), 4);
  });
  it("more than 14 days overdue with no reminder yet goes to the team, not the sequence", () => {
    assert.equal(nextReminderStage(0, 15), null);
    assert.equal(nextReminderStage(0, 34), null);
    assert.equal(nextReminderStage(0, 14), 1);
  });
  it("last one is the final reminder", () => {
    const c = reminderCopy(4, { name: "Maryna", reference: "INV-1", amount: "£198.00", dueLabel: "16 Oct", jobLabel: "JOB-1", payUrl: null });
    assert.equal(c.final, true);
    assert.match(c.subject, /^Final reminder/);
    assert.match(reminderCopy(1, { name: "x", reference: "INV-1", amount: "£1", dueLabel: "d", jobLabel: "j", payUrl: null }).subject, /^Payment reminder/);
  });
});
