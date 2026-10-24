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
  assert.match(line, /Thu 18 Jun 26/);
  assert.match(line, /Arrival time/i);
});

test("job offer shows Date and Arrival metrics in the email format", () => {
  const { html, text } = buildPartnerJobConfirmationRequestEmail({
    partnerFirstName: "Acme Plumbing",
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

  assert.match(html, />Date &amp; time<\/p>/);
  assert.match(html, />Thu 18 Jun 26<\/p>/);
  assert.match(html, />11:00-14:00<\/p>/);
  assert.match(text, /^Date & time:\s+Thu 18 Jun 26, 11:00-14:00/m);
  assert.match(text, /^Your rate:\s+£249\.00, Fixed price/m);
  assert.doesNotMatch(html + text, /inc VAT/i);
  assert.match(html, /href="https:\/\/example\.com\/accept"/);
  assert.doesNotMatch(html + text, /[—–]|\{\{/);
});

test("job offer HTML shows TBC when no schedule", () => {
  const { html, text } = buildPartnerJobConfirmationRequestEmail({
    partnerFirstName: "Acme Plumbing",
    jobReference: "JOB-9270",
    jobTitle: "Carpenter",
    clientName: "Client",
    propertyAddress: "SE8 3AJ",
    scope: "Hang doors",
    priceDisplay: "£249.00",
    acceptUrl: "https://example.com/accept",
  });

  assert.match(html, />TBC<\/p>/);
  assert.match(text, /Date & time:\s+TBC/);
});
