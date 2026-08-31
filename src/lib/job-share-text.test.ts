import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildJobShareText, postcodeFromAddress } from "@/lib/job-share-text";
import type { Job } from "@/types/database";

/**
 * O texto que se cola no WhatsApp. Os guardas que importam: o valor é o pay do
 * PARCEIRO (nunca o preço do cliente) e a localização é só o postcode (nunca a
 * rua). Vazar qualquer um dos dois num grupo de WhatsApp não tem undo.
 */
const base = {
  title: "EICR Safety Check - Studio/1-Bed Flat",
  property_address: "Flat 56, Kempton House, 122 High Street, Staines-upon-Thames, TW18 4EQ",
  scheduled_date: "2026-08-31",
  scheduled_start_at: "2026-08-31T11:00:00Z",
  scheduled_end_at: "2026-08-31T14:00:00Z",
  job_type: "fixed",
  partner_cost: 57.3,
  hourly_partner_rate: null,
  rate_basis: null,
  client_price: 95.5,
  scope: "Job: EICR Safety Check\n\nStudio or 1-bedroom flat (up to 8 circuits)",
} as unknown as Job;

describe("resumo do job pra WhatsApp", () => {
  it("postcode sai, rua nao", () => {
    const t = buildJobShareText(base);
    assert.match(t, /\*Postcode:\* TW18 4EQ/);
    assert.doesNotMatch(t, /Kempton|High Street|Flat 56/);
  });

  it("valor e o pay do parceiro com rotulo, nunca o preco do cliente", () => {
    const t = buildJobShareText(base);
    assert.match(t, /\*Pay:\* Fixed · £57\.30/);
    assert.doesNotMatch(t, /95\.5/);
  });

  it("hourly e day rate carregam o rotulo do acordo", () => {
    const h = buildJobShareText({ ...base, job_type: "hourly", hourly_partner_rate: 45 } as Job);
    assert.match(h, /\*Pay:\* Hourly · £45\.00\/hr/);
    const d = buildJobShareText({ ...base, rate_basis: "daily", partner_cost: 180 } as Job);
    assert.match(d, /\*Pay:\* Day rate · £180\.00/);
  });

  it("data em Londres com janela; sem data vira To be confirmed", () => {
    const t = buildJobShareText(base);
    // 11:00Z em agosto (BST) = meio-dia de Londres
    assert.match(t, /\*Date:\* Mon 31 Aug · Arrival 12:00PM–3:00PM/);
    const sem = buildJobShareText({ ...base, scheduled_date: null, scheduled_start_at: null, scheduled_end_at: null } as unknown as Job);
    assert.match(sem, /\*Date:\* To be confirmed/);
  });

  it("scope inteiro entra; sem scope a linha some", () => {
    assert.match(buildJobShareText(base), /\*Scope:\*\nJob: EICR Safety Check/);
    assert.doesNotMatch(buildJobShareText({ ...base, scope: "  " } as Job), /Scope/);
  });

  it("postcodeFromAddress aguenta virgula final e caixa baixa, e falha limpo", () => {
    assert.equal(postcodeFromAddress("2 Half Moon Crescent, London, n1 9ss,"), "N1 9SS");
    assert.equal(postcodeFromAddress("sem postcode nenhum"), null);
    assert.equal(postcodeFromAddress(null), null);
  });
});
