import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPartnerJobConfirmationRequestEmail,
  formatPartnerJobEmailScheduleLine,
} from "./partner-job-confirmation";

test("formatPartnerJobEmailScheduleLine returns TBC when no schedule fields", () => {
  assert.equal(formatPartnerJobEmailScheduleLine({}), "TBC");
});

test("formatPartnerJobEmailScheduleLine includes arrival window when start/end set", () => {
  const line = formatPartnerJobEmailScheduleLine({
    scheduledDate: "2026-06-18",
    scheduledStartAt: "2026-06-18T10:00:00.000Z",
    scheduledEndAt: "2026-06-18T13:00:00.000Z",
  });
  assert.match(line, /Jun 2026/);
  assert.match(line, /Arrival time/i);
});

test("job offer HTML includes Date row with schedule line", () => {
  const { html, text } = buildPartnerJobConfirmationRequestEmail({
    partnerFirstName: "Mo",
    jobReference: "JOB-9270",
    jobTitle: "Carpenter",
    clientName: "Client",
    propertyAddress: "SE8 3AJ",
    scheduledDate: "2026-06-18",
    scheduledStartAt: "2026-06-18T10:00:00.000Z",
    scheduledEndAt: "2026-06-18T13:00:00.000Z",
    scope: "Hang doors",
    priceDisplay: "£249.00 inc VAT",
    acceptUrl: "https://example.com/accept",
  });

  assert.match(html, />Date<\/p>/);
  assert.match(html, /Arrival time/i);
  assert.match(text, /^Date:\s+/m);
  assert.match(text, /Arrival time/i);
});

test("job offer HTML shows TBC when no schedule", () => {
  const { html, text } = buildPartnerJobConfirmationRequestEmail({
    partnerFirstName: "Mo",
    jobReference: "JOB-9270",
    jobTitle: "Carpenter",
    clientName: "Client",
    propertyAddress: "SE8 3AJ",
    scope: "Hang doors",
    priceDisplay: "£249.00",
    acceptUrl: "https://example.com/accept",
  });

  assert.match(html, />TBC<\/p>/);
  assert.match(text, /Date:\s+TBC/);
});
