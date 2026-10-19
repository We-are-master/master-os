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

test("assuntos, primeiro nome e preço (copy de 20/10/2026, ids 43 a 45)", () => {
  const e = email1(base);
  assert.equal(e.subject, "Your Fixfy booking is saved");
  assert.equal(e.preheader, "Pick up your 2 bed deep clean booking where you left off.");
  assert.match(e.html, /Hi Alex,/);
  assert.match(e.html, /£237/);
  assert.match(e.text, /Property postcode: SE12 8AA/);
  assert.match(e.text, /Continue your booking: https:/);
  assert.equal(email2(base).subject, "A question about your Fixfy booking?");
  assert.equal(email3({ ...base, promo: { code: "X", percentOff: 10, discountedPrice: 213.3 } }).subject, "10% off your saved Fixfy booking");
  assert.equal(formatarLibras(213.3), "£213.30");
});

test("sem nome: Hi there; sem preço guardado: a linha some", () => {
  const e = email1({ ...base, firstName: null, price: 0 });
  assert.match(e.text, /Hi there,/);
  assert.doesNotMatch(e.text, /Saved price/);
});

test("rodapé de marketing com o descadastro e nada que a copy proíbe", () => {
  const e3 = email3({ ...base, promo: { code: "COMEBACK10", percentOff: 10, discountedPrice: 213.3, expiresAt: null } });
  for (const e of [email1(base), email2(base), e3]) {
    assert.match(e.html, /href="https:\/\/app\.getfixfy\.com\/unsubscribe\/x"[^>]*>Unsubscribe</);
    assert.match(e.text, /started a booking at getfixfy\.com\. Unsubscribe: https:\/\/app\.getfixfy\.com\/unsubscribe\/x/);
    const tudo = e.subject + e.preheader + e.text;
    assert.doesNotMatch(tudo, /hidden charges|nothing gets added|a minute|14[- ]day|guarantee|already applied|reserved/i);
    assert.ok(!(tudo + e.html).includes("{{"));
  }
});

test("e-mail 3 exige o código e mostra os dois preços", () => {
  assert.throws(() => email3(base));
  const e = email3({ ...base, promo: { code: "BACK-7K2Q", percentOff: 10, discountedPrice: 213.3, expiresAt: new Date("2026-09-27T09:00:00Z") } });
  assert.match(e.html, /BACK-7K2Q/);
  assert.match(e.html, /£213\.30/);
  assert.match(e.text, /That brings the price from £237 to £213\.30\. The offer is valid until Sun 27 Sep 26 at 10am \(UK time\)\./);
  assert.match(e.text, /Valid until: Sun 27 Sep 26 at 10am \(UK time\)/);
});

test("sem travessão no texto que o cliente lê", () => {
  const e = email3({ ...base, promo: { code: "X", percentOff: 10, discountedPrice: 213.3, expiresAt: new Date() } });
  for (const t of [email1(base), email2(base), e]) {
    assert.ok(!/[—–]/.test(t.text + t.subject + t.preheader + t.html));
  }
});

test("cupom fixo (sem chave da Stripe): sem prazo e sem 'personal'", () => {
  const e = email3({ ...base, promo: { code: "COMEBACK10", percentOff: 10, discountedPrice: 213.3, expiresAt: null } });
  assert.match(e.html, /COMEBACK10/);
  assert.doesNotMatch(e.text, /valid until|personal|unique|48 hours/i);
  assert.doesNotMatch(e.preheader, /48 hours|personal/i);
  assert.match(e.text, /you can use COMEBACK10 for 10% off your eligible booking/);
  assert.equal(e.preheader, "Use COMEBACK10 when you return to your 2 bed deep clean booking.");
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
  const conserto = email2({ ...base, kind: "trade", service: { name: "handyman half day", withArticle: "a handyman half day" } });
  assert.doesNotMatch(conserto.text + conserto.html, /every room|checklist/i);
  assert.match(conserto.text, /If you paused your handyman half day booking/);
  assert.match(conserto.text, /Message us on WhatsApp: https:\/\/wa\.me/);
});

test("escapa o que vem do lead", () => {
  const e = email1({ ...base, firstName: "<b>x", service: { name: "<script>alert(1)</script>", withArticle: "x" } });
  assert.ok(!e.html.includes("<script>alert") && !e.html.includes("<b>x"));
});
