import { strict as assert } from "node:assert";
import { test } from "node:test";
import { email1, email2, email3, formatarLibras, type ReservaAbandonada } from "./reserva-abandonada";

// Os horários de cada e-mail moram em src/lib/site-leads/agenda.ts (e no teste dele).

const base: ReservaAbandonada = {
  firstName: "alex smith",
  service: { name: "2 bed deep clean", withArticle: "a 2 bed deep clean" },
  details: ["2 bedrooms", "Oven included"],
  postcode: "se12 8aa",
  price: 237,
  resumeUrl: "https://www.getfixfy.com/?s=clean&kind=deep&size=2",
  whatsappUrl: "https://wa.me/442045384668",
  unsubscribeUrl: "https://app.getfixfy.com/unsubscribe/x",
  assetBase: "https://app.getfixfy.com",
};

test("assuntos, primeiro nome e preço", () => {
  const e = email1(base);
  assert.equal(e.subject, "You're almost there!");
  assert.ok(e.preheader.startsWith("Finish your booking: 2 bed deep clean"));
  assert.match(e.html, /Hi Alex,/);
  assert.match(e.html, /£237/);
  assert.equal(email2(base).subject, "Anything we can help with?");
  assert.equal(formatarLibras(213.3), "£213.30");
});

test("e-mail 3 exige o código e mostra os dois preços", () => {
  assert.throws(() => email3(base));
  const e = email3({ ...base, promo: { code: "BACK-7K2Q", percentOff: 10, discountedPrice: 213.3, expiresAt: new Date("2026-09-27T09:00:00Z") } });
  assert.equal(e.subject, "Get 10% OFF to finish your booking");
  assert.match(e.html, /BACK-7K2Q/);
  assert.match(e.html, /£213\.30/);
  assert.match(e.text, /Sunday 27 September at 10:00/);
});

test("sem travessão no texto que o cliente lê", () => {
  const e = email3({ ...base, promo: { code: "X", percentOff: 10, discountedPrice: 213.3, expiresAt: new Date() } });
  for (const t of [email1(base), email2(base), e]) {
    assert.ok(!t.text.includes("—") && !t.subject.includes("—"));
  }
});

test("cupom fixo (sem chave da Stripe): sem prazo e sem 'personal'", () => {
  const e = email3({ ...base, promo: { code: "COMEBACK10", percentOff: 10, discountedPrice: 213.3, expiresAt: null } });
  assert.match(e.html, /COMEBACK10/);
  assert.doesNotMatch(e.text, /valid until|personal|unique|48 hours/i);
  assert.doesNotMatch(e.preheader, /48 hours|personal/i);
  assert.match(e.text, /We've applied code COMEBACK10 to your booking/);
  assert.equal(e.preheader, "£237 is now £213.30 with code COMEBACK10, already applied.");
});

test("o encoded id do ticket vai escondido no fim, no HTML e no texto, nos três", () => {
  const comTicket = { ...base, ticketRef: "zrggkr-jxx2n", promo: { code: "COMEBACK10", percentOff: 10, discountedPrice: 213.3, expiresAt: null } };
  for (const e of [email1(comTicket), email2(comTicket), email3(comTicket)]) {
    assert.match(e.html, /<span class="zd_encoded_id" aria-hidden="true" style="[^"]*font-size:1px[^"]*">\[ZRGGKR-JXX2N\]<\/span>/);
    assert.ok(e.text.trimEnd().endsWith("[ZRGGKR-JXX2N]"));
  }
  // sem ticket, ou com lixo no lugar do id, nada entra
  for (const ref of [undefined, null, "", "<script>", "12345"]) {
    const e = email1({ ...base, ticketRef: ref as string | null | undefined });
    assert.doesNotMatch(e.html, /zd_encoded_id/);
    assert.doesNotMatch(e.text, /\[[A-Z0-9-]+\]\s*$/);
  }
});

test("e-mail 2 de conserto não fala de cômodo nem de checklist", () => {
  const limpeza = email2(base);
  assert.match(limpeza.text, /Photos of every room/);
  assert.match(limpeza.text, /agreed checklist/);
  const conserto = email2({ ...base, kind: "trade", service: { name: "handyman half day", withArticle: "a handyman half day" } });
  assert.doesNotMatch(conserto.text + conserto.html, /every room|checklist/i);
  assert.match(conserto.text, /Photos of the finished work/);
});
