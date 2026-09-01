import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildJobShareText, buildJobsRouteMapsUrl, buildJobsRouteShareText, postcodeFromAddress } from "@/lib/job-share-text";
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

/**
 * Rota em lote (seleção na lista de Jobs): a regra de endereço INVERTE com
 * critério — job COM parceiro mostra a rua (briefing de quem aceitou), job sem
 * parceiro fica no postcode, inclusive dentro do link do Maps compartilhado.
 * Dinheiro nunca entra na mensagem de rota.
 */
const stopA = {
  ...base,
  id: "a",
  title: "General Maintenance",
  property_address: "Flat B, 130 Landor Road, London, SW9 9JB",
  scheduled_date: "2026-08-31",
  scheduled_start_at: "2026-08-31T07:00:00Z",
  scheduled_end_at: "2026-08-31T11:00:00Z",
  partner_id: "p1",
  partner_name: "G&M Services",
  scope: "Fix the door",
} as unknown as Job;
const stopB = {
  ...base,
  id: "b",
  title: "Cleaning",
  property_address: "65 Barleycorn Way, London, E14 8DE",
  scheduled_date: "2026-08-31",
  scheduled_start_at: "2026-08-31T12:00:00Z",
  scheduled_end_at: "2026-08-31T14:00:00Z",
  partner_id: null,
  partner_name: null,
  scope: "Deep clean kitchen",
} as unknown as Job;

describe("rota em lote pra WhatsApp e Maps", () => {
  it("ordena por inicio agendado e numera as paradas", () => {
    const t = buildJobsRouteShareText([stopB, stopA]);
    const posA = t.indexOf("General Maintenance");
    const posB = t.indexOf("Cleaning");
    assert.ok(posA >= 0 && posB >= 0 && posA < posB, "A (8AM) vem antes de B (1PM)");
    assert.match(t, /\*1\) General Maintenance\*/);
    assert.match(t, /\*2\) Cleaning\*/);
  });

  it("endereco completo so com parceiro; sem parceiro sai postcode", () => {
    const t = buildJobsRouteShareText([stopA, stopB]);
    assert.match(t, /130 Landor Road/);
    assert.doesNotMatch(t, /Barleycorn Way/);
    assert.match(t, /E14 8DE/);
  });

  it("scope de cada parada entra na MESMA mensagem, e dinheiro nao", () => {
    const t = buildJobsRouteShareText([stopA, stopB]);
    assert.match(t, /Scope:\nFix the door/);
    assert.match(t, /Scope:\nDeep clean kitchen/);
    assert.doesNotMatch(t, /£/);
    assert.doesNotMatch(t, /Pay/);
  });

  it("link do Maps compartilhado usa postcode pro job sem parceiro", () => {
    const t = buildJobsRouteShareText([stopA, stopB]);
    assert.match(t, /Open route: https:\/\/www\.google\.com\/maps\/dir\/\?/);
    const url = new URL(t.split("Open route: ")[1]!.split("\n")[0]!);
    assert.equal(url.searchParams.get("destination"), "E14 8DE");
    assert.match(url.searchParams.get("waypoints") ?? "", /Landor Road/);
  });

  it("modo precise (botao proprio) usa endereco completo mesmo sem parceiro", () => {
    const url = buildJobsRouteMapsUrl([stopA, stopB], { precise: true })!;
    assert.match(url, /Barleycorn\+Way|Barleycorn%20Way/);
  });

  it("sem endereco nenhum devolve null em vez de link vazio", () => {
    const semNada = { ...stopA, property_address: null, latitude: null, longitude: null } as unknown as Job;
    assert.equal(buildJobsRouteMapsUrl([semNada]), null);
  });

  it("data unica sobe pro cabecalho; datas mistas descem pra cada parada", () => {
    const mesmoDia = buildJobsRouteShareText([stopA, stopB]);
    assert.match(mesmoDia, /\*Route · 2 stops · Mon 31 Aug\*/);
    const outroDia = { ...stopB, scheduled_date: "2026-09-01" } as unknown as Job;
    const misto = buildJobsRouteShareText([stopA, outroDia]);
    assert.match(misto, /\*Route · 2 stops\*/);
    assert.match(misto, /Tue 1 Sep/);
  });
});
