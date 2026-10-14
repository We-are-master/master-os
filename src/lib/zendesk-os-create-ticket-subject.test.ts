import { test } from "node:test";
import assert from "node:assert/strict";
import { osZendeskCreateTicketSubject } from "./zendesk-os-create-ticket-subject";

test("com postcode: serviço e postcode", () => {
  assert.equal(osZendeskCreateTicketSubject("job", "Carpenter", "1 High St, London E16 2HF"), "Job Scheduled: Carpenter - E16 2HF");
  assert.equal(osZendeskCreateTicketSubject("quote", null, "SW11 1BG"), "Quote Request: Quote - SW11 1BG");
});

test("sem postcode: sem o travessão no fim", () => {
  const s = osZendeskCreateTicketSubject("job", "After Builders Clean", "Flat 2");
  assert.equal(s, "Job Scheduled: After Builders Clean");
  assert.ok(!s.includes("—"));
});
