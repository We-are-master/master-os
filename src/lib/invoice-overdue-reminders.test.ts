import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOverdueReminderEmail, daysOverdue, nextReminderStage, reminderCopy } from "./invoice-overdue-reminders";

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
    const c = reminderCopy(4, { reference: "INV-1", amount: "£198.00", dueLabel: "Fri 16 Oct 26" });
    assert.equal(c.final, true);
    assert.equal(c.subject, "Final payment reminder · INV-1");
  });
});

describe("overdue reminder emails (copy 15 to 18)", () => {
  const base = {
    publico: { tipo: "b2c" as const, primeiroNome: "Sarah Jones" },
    invoiceReference: "RCP-2026-999",
    amount: 180,
    dueDate: "2026-10-21",
    documentName: "invoice" as const,
    payUrl: "https://app.getfixfy.com/pay/INV-2026-999",
    bankRows: [["Account name", "SAMPLE LTD"], ["Sort code", "00-00-00"]] as Array<[string, string]>,
  };
  const subjects: Record<number, string> = {
    1: "Payment reminder · INV-2026-999",
    2: "Payment outstanding · INV-2026-999",
    3: "Payment update requested · INV-2026-999",
    4: "Final payment reminder · INV-2026-999",
  };
  for (const stage of [1, 2, 3, 4]) {
    it(`stage ${stage}: subject, one normalised reference, no dashes, no placeholders`, () => {
      const e = buildOverdueReminderEmail({ ...base, stage });
      assert.equal(e.subject, subjects[stage]);
      const all = e.subject + e.html + e.text;
      assert.doesNotMatch(all, /[–—]/);
      assert.doesNotMatch(all, /\{\{/);
      assert.doesNotMatch(e.text, /RCP-/);
      assert.match(e.text, /^PAYMENT|^FINAL/);
      assert.match(e.text, /Hi Sarah,/);
      assert.match(e.text, /Wed 21 Oct 26/);
      assert.match(e.text, /quote INV-2026-999/);
    });
  }
  it("each stage has its own body", () => {
    const bodies = [1, 2, 3, 4].map((s) => buildOverdueReminderEmail({ ...base, stage: s }).text.split("Hi Sarah,")[1]!.split("Reference:")[0]);
    assert.equal(new Set(bodies).size, 4);
  });
  it("B2B greets the company, never a person", () => {
    const e = buildOverdueReminderEmail({ ...base, stage: 1, publico: { tipo: "b2b", empresa: "Acme Lettings" } });
    assert.match(e.text, /Hi Acme Lettings team,/);
  });
  it("no bank details configured: no transfer module", () => {
    const e = buildOverdueReminderEmail({ ...base, stage: 2, bankRows: [] });
    assert.doesNotMatch(e.text, /Prefer a bank transfer/);
    const com = buildOverdueReminderEmail({ ...base, stage: 2 });
    assert.match(com.text, /Prefer a bank transfer\? Use the details below and quote INV-2026-999\./);
  });
  it("agent model names the statement", () => {
    const e = buildOverdueReminderEmail({ ...base, stage: 1, documentName: "statement" });
    assert.match(e.text, /on statement INV-2026-999/);
  });
});
