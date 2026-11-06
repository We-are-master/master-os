import { test } from "node:test";
import assert from "node:assert/strict";
import { escopoDoSiteLead, leadDaQuote, leadDoSiteLead, quoteAbreLead, segmentoPeloProcesso, type QuoteParaCrm } from "./fontes";

test("segmento pela conta", () => {
  assert.equal(segmentoPeloProcesso("direct"), "b2c");
  assert.equal(segmentoPeloProcesso(null), "b2c");
  assert.equal(segmentoPeloProcesso(""), "b2c");
  assert.equal(segmentoPeloProcesso("platform"), "b2b");
  assert.equal(segmentoPeloProcesso("b2b"), "b2b");
});

test("scope da reserva nunca leva preço", () => {
  const s = escopoDoSiteLead("End of tenancy cleaning, 2 bed (£223)");
  assert.doesNotMatch(s, /£/);
  assert.match(s, /End of tenancy cleaning, 2 bed\./);
  assert.match(escopoDoSiteLead(null), /website/);
});

const base = {
  id: "s1",
  email: " Jo@Example.com ",
  full_name: "Jo Bloggs",
  phone: "07700 900123",
  postcode: "w5 2ab",
  client_id: "c1",
  service_label: "Deep clean · £194",
  zendesk_ticket_id: 48213,
};

test("lead do site nasce em Talking, no ticket do lead do site", () => {
  const l = leadDoSiteLead(base, 50000);
  assert.equal(l.stage, "qualifying");
  assert.equal(l.status, "interested");
  assert.equal(l.segment, "b2c");
  assert.equal(l.source, "website");
  assert.equal(l.external_source, "zendesk");
  assert.equal(l.external_ref, "50000");
  assert.equal(l.email, "jo@example.com");
  assert.equal(l.postcode, "W5 2AB");
  assert.equal(l.client_id, "c1");
  assert.doesNotMatch(String(l.scope), /£/);
  assert.ok(l.next_action);
});

test("sem ticket da resposta, usa o do site; sem nenhum, fica sem ticket", () => {
  assert.equal(leadDoSiteLead(base, null).external_ref, "48213");
  const sem = leadDoSiteLead({ ...base, zendesk_ticket_id: null, full_name: null }, null);
  assert.equal(sem.external_ref, null);
  assert.equal(sem.external_source, null);
  assert.equal(sem.name, "jo");
});

const QUOTE: QuoteParaCrm = {
  id: "q1",
  reference: "QT-1",
  title: "Painting · Jane Doe",
  status: "bidding",
  client_id: "c1",
  client_name: "Jane Doe",
  client_email: "Jane@Example.com",
  property_address: "1 High St, London W5 2AB",
  postcode: "w5 2ab",
  scope: null,
  catalog_service_id: "s1",
  source_account_id: null,
  external_source: "zendesk",
  external_ref: "52001",
};

test("quote sem lead vira card em Quoting, ligado ao ticket e nunca publicado", () => {
  const l = leadDaQuote(QUOTE, "b2c");
  assert.equal(l.stage, "quoting");
  assert.equal(l.name, "Jane Doe");
  assert.equal(l.email, "jane@example.com");
  assert.equal(l.postcode, "W5 2AB");
  assert.equal(l.external_source, "zendesk");
  assert.equal(l.external_ref, "52001");
  assert.equal(l.published_at, null);
  assert.equal(l.scope, "Painting · Jane Doe.");
});

test("quote sem ticket nem preço no scope", () => {
  const l = leadDaQuote({ ...QUOTE, external_source: null, external_ref: null, scope: "Paint the hallway." }, "b2b");
  assert.equal(l.external_ref, null);
  assert.equal(l.segment, "b2b");
  assert.ok(!String(l.scope).includes("£"));
});

test("só quote viva abre card", () => {
  assert.equal(quoteAbreLead("bidding"), true);
  assert.equal(quoteAbreLead("rejected"), false);
  assert.equal(quoteAbreLead(null), false);
});
