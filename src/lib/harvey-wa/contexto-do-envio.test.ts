import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { envioComContexto, notaDoContexto, tagDoEnvio, ticketDoJob, type EnvioRecente, type JobDoEnvio } from "./contexto-do-envio";

const envio = (p: Partial<EnvioRecente> = {}): EnvioRecente => ({
  dedupe_key: "lembrete-24h:job-1:2026-10-28T09:00:00+00:00",
  purpose: "lembrete-24h",
  job_id: "aaaa1111-0000-0000-0000-000000000000",
  quote_id: null,
  zendesk_ticket_id: null,
  template: "booking_reminder",
  sent_at: "2026-10-27T10:00:06.398+00:00",
  reserved_at: "2026-10-27T10:00:06.219+00:00",
  ...p,
});

const job: JobDoEnvio = {
  id: "aaaa1111-0000-0000-0000-000000000000",
  reference: "JOB-0001",
  title: "End-of-tenancy clean",
  property_address: "1 Test Street, London, E1 1AA",
  scheduled_start_at: "2026-10-28T09:00:00+00:00",
  scheduled_end_at: "2026-10-28T12:00:00+00:00",
  scheduled_date: "2026-10-28",
  external_source: "zendesk",
  external_ref: "50001",
};

describe("WhatsApp conversation: context of what we sent", () => {
  it("the note says what was sent, the job and both links", () => {
    const nota = notaDoContexto(envio(), "+447700900000", job);
    assert.match(nota, /day-before reminder on WhatsApp, sent Tue 27 Oct, 10:00 to \+447700900000 \(template booking_reminder\)/);
    assert.match(nota, /JOB-0001 · End-of-tenancy clean · Wed 28 Oct, 09:00-12:00 · 1 Test Street/);
    assert.match(nota, /#50001 https:\/\/fixfy\.zendesk\.com\/agent\/tickets\/50001/);
    assert.match(nota, /https:\/\/app\.getfixfy\.com\/jobs\/aaaa1111-0000-0000-0000-000000000000/);
  });
  it("lead templates are left to the lead merge", () => {
    assert.equal(envioComContexto(envio({ purpose: "primeiro-contato", job_id: null })), false);
    assert.equal(envioComContexto(envio()), true);
    assert.equal(envioComContexto(envio({ job_id: null, quote_id: "q1" })), true);
  });
  it("quote follow-up without a job points at the quote ticket", () => {
    const nota = notaDoContexto(envio({ purpose: "quote-chase-1", job_id: null, quote_id: "q1", zendesk_ticket_id: 50002 }), "+447700900000", null);
    assert.match(nota, /our quote follow-up on WhatsApp/);
    assert.match(nota, /Ticket: #50002/);
  });
  it("one tag per send: a new reminder next week gets its own note", () => {
    assert.equal(tagDoEnvio(envio()), "ctx_lembrete_24h_aaaa1111_20261027");
    assert.notEqual(tagDoEnvio(envio()), tagDoEnvio(envio({ sent_at: "2026-11-03T10:00:00Z" })));
  });
  it("job ticket only when the job lives in Zendesk", () => {
    assert.equal(ticketDoJob(job), 50001);
    assert.equal(ticketDoJob({ ...job, external_source: "housekeep", external_ref: "HK-1" }), null);
  });
});
