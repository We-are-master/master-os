import assert from "node:assert/strict";
import { test } from "node:test";
import {
  certificateAttachmentUrls,
  certificateValidity,
  expiryHeadline,
  expirySourceNote,
  expiryStatus,
  formatExpiryDisplay,
  isPlausibleExpiry,
  toIsoDate,
  toUkDate,
} from "./certificate-expiry";

// ─── Date parsing ────────────────────────────────────────────────────────────

test("reads UK day-first dates", () => {
  assert.equal(toIsoDate("08/07/2027"), "2027-07-08");
  assert.equal(toIsoDate("8/7/2027"), "2027-07-08");
  assert.equal(toIsoDate("08-07-2027"), "2027-07-08");
  assert.equal(toIsoDate("08.07.2027"), "2027-07-08");
});

test("reads ISO dates unchanged", () => {
  assert.equal(toIsoDate("2027-07-08"), "2027-07-08");
});

test("13/07 is July, never a month 13", () => {
  // The whole point of day-first: a day above 12 must not be read as a month.
  assert.equal(toIsoDate("13/07/2027"), "2027-07-13");
});

test("rejects junk, impossible days and empty values", () => {
  assert.equal(toIsoDate("31/02/2027"), null);
  assert.equal(toIsoDate("00/07/2027"), null);
  assert.equal(toIsoDate("08/13/2027"), null);
  assert.equal(toIsoDate("next year"), null);
  assert.equal(toIsoDate(""), null);
  assert.equal(toIsoDate(null), null);
  assert.equal(toIsoDate(undefined), null);
  assert.equal(toIsoDate(20270708), null);
});

test("writes back the shape the office types", () => {
  assert.equal(toUkDate("2027-07-08"), "08/07/2027");
  assert.equal(toUkDate("nope"), null);
});

test("display format is British and does not shift the day", () => {
  assert.equal(formatExpiryDisplay("2027-07-08"), "8 Jul 2027");
  assert.equal(formatExpiryDisplay("2027-01-01"), "1 Jan 2027");
});

// ─── Status ──────────────────────────────────────────────────────────────────

const NOW = new Date("2026-08-14T09:00:00Z");

test("a certificate expiring today is still valid today", () => {
  assert.deepEqual(expiryStatus("2026-08-14", NOW), { state: "expiring", days: 0 });
});

test("yesterday is expired", () => {
  const s = expiryStatus("2026-08-13", NOW);
  assert.equal(s?.state, "expired");
  assert.equal(s?.days, -1);
});

test("the renewal window opens two months out, not one", () => {
  // 60 days so the landlord message can go out one or two months ahead.
  assert.equal(expiryStatus("2026-10-13", NOW)?.state, "expiring"); // 60 days
  assert.equal(expiryStatus("2026-10-14", NOW)?.state, "valid");    // 61 days
});

test("a year out is plainly valid", () => {
  const s = expiryStatus("2027-07-08", NOW);
  assert.equal(s?.state, "valid");
  assert.equal(s?.days, 328);
});

// ─── The misread guard ───────────────────────────────────────────────────────

test("accepts the real CP12 reading", () => {
  // JOB-9338: visit 09/07/2026, certificate expires 08/07/2027.
  assert.equal(isPlausibleExpiry("2027-07-08", new Date("2026-07-09T12:47:00Z")), true);
});

test("rejects the expiry the model invents when it cannot see the page", () => {
  // Reading the same PDF as text only, the model returned 2023 for a 2026 job.
  assert.equal(isPlausibleExpiry("2023-08-07", new Date("2026-07-09T12:47:00Z")), false);
});

test("accepts a certificate dated the day before the visit", () => {
  assert.equal(isPlausibleExpiry("2026-08-13", new Date("2026-08-14T09:00:00Z")), true);
});

test("rejects a date beyond the longest UK validity", () => {
  // The EPC is 10 years; 12 means a misread year.
  assert.equal(isPlausibleExpiry("2038-08-14", NOW), false);
  assert.equal(isPlausibleExpiry("2036-08-14", NOW), true);
});

// ─── Attachments ─────────────────────────────────────────────────────────────

test("finds the attached certificate", () => {
  assert.deepEqual(
    certificateAttachmentUrls({ photos: { certificate: ["https://x/a.pdf", "https://x/b.pdf"] } }),
    ["https://x/a.pdf", "https://x/b.pdf"],
  );
});

test("no attachment when the slot is missing, empty or the wrong shape", () => {
  assert.deepEqual(certificateAttachmentUrls({ photos: { after: ["https://x/a.jpg"] } }), []);
  assert.deepEqual(certificateAttachmentUrls({ photos: [] }), []);
  assert.deepEqual(certificateAttachmentUrls(null), []);
  assert.deepEqual(certificateAttachmentUrls({ photos: { certificate: [null, ""] } }), []);
});

// ─── The one answer the UI asks for ──────────────────────────────────────────

test("silent on templates that have no expiry", () => {
  assert.equal(certificateValidity({ template: "general", expiry_date: "08/07/2027" }, NOW), null);
  assert.equal(certificateValidity(null, NOW), null);
});

test("silent when the certificate carries no date at all", () => {
  assert.equal(certificateValidity({ template: "certificate", certificate_issued: true }, NOW), null);
});

test("a typed date reads as typed", () => {
  const v = certificateValidity({ template: "certificate", expiry_date: "08/07/2027" }, NOW);
  assert.equal(v?.iso, "2027-07-08");
  assert.equal(v?.display, "8 Jul 2027");
  assert.equal(v?.source, "manual");
  assert.equal(v?.state, "valid");
});

test("the model's reading shows when the field was left blank", () => {
  const v = certificateValidity(
    {
      template: "certificate",
      certificate_ai: { expiry_date: "2027-07-27", confidence: "high", applied: true },
    },
    NOW,
  );
  assert.equal(v?.iso, "2027-07-27");
  assert.equal(v?.source, "ai");
  assert.equal(v?.confidence, "high");
});

test("a date we wrote ourselves still credits the model", () => {
  // We fill the field and the envelope together; the field alone would look typed.
  const v = certificateValidity(
    {
      template: "certificate",
      expiry_date: "27/07/2027",
      certificate_ai: { expiry_date: "2027-07-27", confidence: "high", applied: true },
    },
    NOW,
  );
  assert.equal(v?.source, "ai");
});

test("a person correcting the model wins", () => {
  const v = certificateValidity(
    {
      template: "certificate",
      expiry_date: "08/07/2027",
      certificate_ai: { expiry_date: "2023-08-07", confidence: "low", applied: false },
    },
    NOW,
  );
  assert.equal(v?.iso, "2027-07-08");
  assert.equal(v?.source, "manual");
});

test("an expired certificate says so", () => {
  const v = certificateValidity({ template: "certificate", expiry_date: "01/01/2026" }, NOW);
  assert.equal(v?.state, "expired");
  assert.ok((v?.days ?? 0) < 0);
});

// ─── Copy ────────────────────────────────────────────────────────────────────

const headlineFor = (expiry: string) => {
  const v = certificateValidity({ template: "certificate", expiry_date: expiry }, NOW);
  assert.ok(v, `no validity for ${expiry}`);
  return expiryHeadline(v);
};

test("the headline counts days without ever saying '1 days'", () => {
  assert.equal(headlineFor("14/08/2026"), "Expires today · 14 Aug 2026");
  assert.equal(headlineFor("15/08/2026"), "Expires tomorrow · 15 Aug 2026");
  assert.equal(headlineFor("13/08/2026"), "Expired yesterday · 13 Aug 2026");
  assert.equal(headlineFor("24/08/2026"), "Expires in 10 days · 24 Aug 2026");
  assert.equal(headlineFor("04/08/2026"), "Expired 10 days ago · 4 Aug 2026");
});

test("a healthy certificate just gives the date", () => {
  assert.equal(headlineFor("08/07/2027"), "Valid until 8 Jul 2027");
});

test("a shaky reading asks to be checked, a confident one does not", () => {
  const note = (confidence: string) =>
    expirySourceNote(
      certificateValidity(
        { template: "certificate", certificate_ai: { expiry_date: "2027-07-08", confidence, applied: true } },
        NOW,
      )!,
    );
  assert.doesNotMatch(note("high"), /check/i);
  assert.match(note("medium"), /check/i);
  assert.match(note("low"), /check/i);
  assert.doesNotMatch(
    expirySourceNote(certificateValidity({ template: "certificate", expiry_date: "08/07/2027" }, NOW)!),
    /check/i,
  );
});
