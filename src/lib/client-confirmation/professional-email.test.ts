import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildProfessionalConfirmedEmail,
  enviarEmailConfirmadoComProfissional,
  rotuloDaJanela,
} from "./professional-email";

const input = {
  firstName: "Jane",
  ref: "JOB-9701",
  summary: "End of tenancy clean",
  dateLabel: "Thursday 8 October",
  windowLabel: "between 9am and 12pm",
  addressLine: "1 High St, London E3 4AA",
  professionalName: "Sparkle Clean Ltd",
  professionalAddress: "12 Mare Street, London E8 4RP",
  professionalVatNumber: null,
  lines: [{ label: "End of tenancy clean", amount: 266 }],
  amountPaid: 133,
  balance: 133,
  attachmentKind: "statement" as const,
  isEndOfTenancy: true,
  calendarUrl: null,
};

describe("buildProfessionalConfirmedEmail (04-booking-copy C2)", () => {
  it("names the professional in the subject and the body, as agent", () => {
    const m = buildProfessionalConfirmedEmail(input);
    assert.equal(m.subject, "Booking confirmed with Sparkle Clean Ltd: End of tenancy clean on Thursday 8 October (JOB-9701)");
    assert.match(m.html, /Job Confirmed\./);
    assert.match(m.html, /Paid to GETFIXFY LTD \(Fixfy\), as agent for Sparkle Clean Ltd/);
    assert.match(m.html, /Not VAT registered, so no VAT is charged/);
    assert.match(m.html, /Free re-clean within 7 days\./);
    assert.match(m.text, /your contract for this job is with Sparkle Clean Ltd/);
  });

  it("no em or en dashes, and no Fixfy VAT number", () => {
    const m = buildProfessionalConfirmedEmail(input);
    for (const t of [m.subject, m.html, m.text]) {
      assert.doesNotMatch(t, /[\u2013\u2014]/);
      assert.doesNotMatch(t, /478 1027 82/);
    }
  });
});

describe("rotuloDaJanela", () => {
  it("reads like a person in London", () => {
    assert.equal(rotuloDaJanela("2026-10-08T08:00:00Z", "2026-10-08T11:00:00Z"), "between 9am and 12pm");
    assert.equal(rotuloDaJanela("2026-12-08T09:30:00Z", "2026-12-08T13:00:00Z"), "between 9:30am and 1pm");
    assert.equal(rotuloDaJanela(null, "2026-10-08T11:00:00Z"), null);
  });
});

describe("enviarEmailConfirmadoComProfissional gates", () => {
  const before = { a: process.env.FIXFY_AGENT_MODEL, m: process.env.CLIENT_MESSAGING_ENABLED };
  afterEach(() => {
    if (before.a === undefined) delete process.env.FIXFY_AGENT_MODEL;
    else process.env.FIXFY_AGENT_MODEL = before.a;
    if (before.m === undefined) delete process.env.CLIENT_MESSAGING_ENABLED;
    else process.env.CLIENT_MESSAGING_ENABLED = before.m;
  });
  const boom = { from() { throw new Error("must not query"); } } as unknown as SupabaseClient;

  it("agent model off: skips without touching the database", async () => {
    delete process.env.FIXFY_AGENT_MODEL;
    process.env.CLIENT_MESSAGING_ENABLED = "1";
    const r = await enviarEmailConfirmadoComProfissional(boom, "job-1");
    assert.equal(r.estado, "pulado");
  });

  it("client messaging off: skips without touching the database", async () => {
    process.env.FIXFY_AGENT_MODEL = "on";
    delete process.env.CLIENT_MESSAGING_ENABLED;
    const r = await enviarEmailConfirmadoComProfissional(boom, "job-1");
    assert.equal(r.estado, "pulado");
  });
});
