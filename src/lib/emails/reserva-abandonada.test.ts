import { strict as assert } from "node:assert";
import { test } from "node:test";
import { agendaDoAbandono, email1, email2, email3, formatarLibras, type ReservaAbandonada } from "./reserva-abandonada";

const iso = (d: Date) => d.toISOString().slice(0, 16);

test("tarde: 1 em 30 min, 2 quatro horas depois, 3 no dia seguinte às 10h", () => {
  // 15:12 em Londres (horário de verão, UTC+1)
  const a = agendaDoAbandono(new Date("2026-09-24T14:12:00Z"));
  assert.equal(iso(a.email1), "2026-09-24T14:42");
  assert.equal(iso(a.email2), "2026-09-24T18:42");
  assert.equal(iso(a.email3), "2026-09-25T09:00");
});

test("e-mail 2 depois das 20h vai para as 8h, e o 3 anda junto", () => {
  // 18:00 em Londres: o 2 cairia 22:30
  const a = agendaDoAbandono(new Date("2026-09-24T17:00:00Z"));
  assert.equal(iso(a.email1), "2026-09-24T17:30");
  assert.equal(iso(a.email2), "2026-09-25T07:00");
  assert.equal(iso(a.email3), "2026-09-26T09:00");
});

test("de madrugada o 1 espera as 8h", () => {
  // 23:00 em Londres
  const a = agendaDoAbandono(new Date("2026-09-24T22:00:00Z"));
  assert.equal(iso(a.email1), "2026-09-25T07:00");
  assert.equal(iso(a.email2), "2026-09-25T11:00");
  assert.equal(iso(a.email3), "2026-09-26T09:00");
});

test("inverno (GMT) e a virada do relógio em 25/10", () => {
  const inverno = agendaDoAbandono(new Date("2026-12-10T15:00:00Z"));
  assert.equal(iso(inverno.email3), "2026-12-11T10:00");
  // 24/10 às 19:00 BST; o 2 vira 8h de 25/10, já em GMT
  const virada = agendaDoAbandono(new Date("2026-10-24T18:00:00Z"));
  assert.equal(iso(virada.email2), "2026-10-25T08:00");
  assert.equal(iso(virada.email3), "2026-10-26T10:00");
});

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
  assert.equal(e.subject, "Your fixed price for a 2 bed deep clean is waiting");
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
