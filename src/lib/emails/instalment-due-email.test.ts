import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildInstalmentDueEmail } from "./instalment-due-email";

describe("copy 14: instalment due today", () => {
  const base = {
    invoiceReference: "RCP-2026-999",
    instalmentNumber: 2,
    instalmentCount: 3,
    amount: 60,
    dueDate: "2026-10-21",
    service: "Bathroom refit",
    payUrl: "https://app.getfixfy.com/pay/INV-2026-999?amount=60.00",
    bankRows: [["Account name", "SAMPLE ONLY"]] as Array<[string, string]>,
  };
  it("subject with normalised reference, date, CTA and transfer", () => {
    const e = buildInstalmentDueEmail({ ...base, publico: { tipo: "b2c", primeiroNome: "Sarah Jones" } });
    assert.equal(e.subject, "Your £60.00 instalment is due today · INV-2026-999");
    assert.match(e.text, /Hi Sarah,/);
    assert.match(e.text, /instalment 2 of 3 for Bathroom refit is due today, Wednesday 21 October 2026/);
    assert.match(e.text, /quote INV-2026-999/);
    assert.doesNotMatch(e.subject + e.html + e.text, /[–—]|\{\{|RCP-/);
  });
  it("B2B and no bank details", () => {
    const e = buildInstalmentDueEmail({ ...base, bankRows: [], publico: { tipo: "b2b", empresa: "Acme Lettings" } });
    assert.match(e.text, /Hi Acme Lettings team,/);
    assert.doesNotMatch(e.text, /Prefer a bank transfer/);
  });
});
