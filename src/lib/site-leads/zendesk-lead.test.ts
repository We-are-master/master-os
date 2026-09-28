import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  assuntoDoTicket,
  codigoDeSaida,
  enderecoDoTicket,
  notaDeAbertura,
  respostaNosComentarios,
  responderPara,
  selecaoEmTexto,
  type ComentarioZendesk,
} from "./zendesk-lead";

const lead = {
  id: "0b7f6d3e-1111-4222-8333-944455556666",
  email: "alex@example.com",
  full_name: "alex smith",
  phone: "07123456789",
  postcode: "se12 8aa",
  service_label: "2 bed deep clean",
  price: 237,
  resume_url: "https://www.getfixfy.com/book?s=clean&kind=deep&size=2&pc=SE12%208AA",
  step_reached: 3,
  selection: { services: ["clean"], size: "2", bathrooms: 2, clean: { kind: "deep", extras: { carpet: 2, fridge: 1, windows: 0 } }, details: ["2 bedrooms", "Oven included"] },
  source: { utm_source: "meta", utm_campaign: "eot-london", utm_content: "card-2" },
};

test("código de saída do postcode", () => {
  assert.equal(codigoDeSaida("SE12 8AA"), "SE12");
  assert.equal(codigoDeSaida("se128aa"), "SE12");
  assert.equal(codigoDeSaida("W1A 1AA"), "W1A");
  assert.equal(codigoDeSaida("EC1V2NX"), "EC1V");
  assert.equal(codigoDeSaida("N6 5QD"), "N6");
  assert.equal(codigoDeSaida("SW1A1AA"), "SW1A");
  assert.equal(codigoDeSaida(""), null);
  assert.equal(codigoDeSaida("12345"), null);
  assert.equal(codigoDeSaida(null), null);
});

test("assunto: serviço e só o começo do postcode", () => {
  assert.equal(assuntoDoTicket(lead), "Website booking not finished · 2 bed deep clean · SE12");
  assert.equal(
    assuntoDoTicket({ id: "x", service_label: "handyman half day", postcode: null }),
    "Website booking not finished · Handyman half day",
  );
  assert.equal(assuntoDoTicket({ id: "x" }), "Website booking not finished · Booking");
});

test("nota de abertura: tudo que o time precisa, em inglês e sem travessão", () => {
  const n = notaDeAbertura(lead);
  assert.match(n, /Service: 2 bed deep clean/);
  assert.match(n, /Price: £237/);
  assert.match(n, /Details: 2 bedrooms · Oven included/);
  assert.match(n, /Selection: services clean · kind deep · size 2 · bathrooms 2 · extras carpet:2, fridge/);
  assert.match(n, /Stopped at: step 3 of 4 \(Date and access\)/);
  assert.match(n, /Resume link: https:\/\/www\.getfixfy\.com\/book\?s=clean/);
  assert.match(n, /Source: utm_source=meta · utm_campaign=eot-london · utm_content=card-2/);
  assert.match(n, /Phone: 07123456789/);
  assert.ok(!n.includes("—"));
  assert.equal(selecaoEmTexto(null), "·");
});

test("endereço do ticket: o alias +id do Zendesk com o encoded id", () => {
  assert.equal(enderecoDoTicket("zrggkr-jxx2n", "fixfy"), "support+idZRGGKR-JXX2N@fixfy.zendesk.com");
  assert.equal(enderecoDoTicket("1G7EOR-0Q2J", "fixfy"), "support+id1G7EOR-0Q2J@fixfy.zendesk.com");
  assert.equal(enderecoDoTicket("12345", "fixfy"), null); // número do ticket não serve: o Zendesk usa o encoded id
  assert.equal(enderecoDoTicket("ZRGGKR-JXX2N", ""), null);
  assert.equal(enderecoDoTicket(null, "fixfy"), null);
});

test("reply-to: o ticket quando existe; o endereço fixo quando o dono pede", () => {
  const env = { ZENDESK_SUBDOMAIN: "fixfy" };
  assert.equal(responderPara("ZRGGKR-JXX2N", env), "support+idZRGGKR-JXX2N@fixfy.zendesk.com");
  assert.equal(responderPara(null, env), "hello@getfixfy.com");
  assert.equal(responderPara(null, { ...env, RESEND_MARKETING_REPLY_TO: "team@getfixfy.com" }), "team@getfixfy.com");
  assert.equal(responderPara("ZRGGKR-JXX2N", { ...env, RESERVA_ABANDONADA_REPLY_TO: "hello@getfixfy.com" }), "hello@getfixfy.com");
  assert.equal(responderPara("ZRGGKR-JXX2N", { ...env, RESERVA_ABANDONADA_REPLY_TO: "ticket" }), "support+idZRGGKR-JXX2N@fixfy.zendesk.com");
});

const c = (id: number, author_id: number, publico: boolean, quando: string, body = "text"): ComentarioZendesk => ({
  id, author_id, public: publico, created_at: quando, body,
});
const usuarios = [{ id: 1, role: "admin" }, { id: 7, role: "agent" }, { id: 5, role: "end-user" }];
const desde = new Date("2026-09-28T10:30:00Z");

test("resposta no ticket do lead: end-user conta, nota interna nossa não", () => {
  const comentarios = [
    c(1, 1, false, "2026-09-28T10:00:00Z", "Booking started on getfixfy.com"),
    c(2, 1, false, "2026-09-28T10:31:00Z", "Email 1 sent"),
    c(3, 5, true, "2026-09-28T11:05:00Z", "Can you come on Friday instead?"),
  ];
  assert.deepEqual(respostaNosComentarios(comentarios, usuarios, desde, 50001), {
    tipo: "cliente", quando: "2026-09-28T11:05:00Z", ticketId: 50001, pedidoDeSaida: false,
  });
  assert.equal(respostaNosComentarios(comentarios.slice(0, 2), usuarios, desde, 50001), null);
});

test("resposta antiga (antes do marco) não conta", () => {
  assert.equal(respostaNosComentarios([c(3, 5, true, "2026-09-28T10:00:00Z")], usuarios, desde, 1), null);
});

test("o time respondendo em público no ticket do lead para a sequência (tipo equipe)", () => {
  const r = respostaNosComentarios([c(4, 7, true, "2026-09-28T12:00:00Z", "Hi Alex, we can do Friday")], usuarios, desde, 1);
  assert.equal(r?.tipo, "equipe");
});

test("em outro ticket só vale o solicitante (nota de agente em ticket de job não é resposta)", () => {
  const outros = [c(8, 7, true, "2026-09-28T12:00:00Z"), c(9, 1, false, "2026-09-28T12:10:00Z")];
  assert.equal(respostaNosComentarios(outros, usuarios, desde, 2, { soDoSolicitante: 5 }), null);
  const r = respostaNosComentarios([...outros, c(10, 5, true, "2026-09-28T12:20:00Z")], usuarios, desde, 2, { soDoSolicitante: 5 });
  assert.equal(r?.tipo, "cliente");
});

test("'Stop promotions' vira pedido de saída", () => {
  const r = respostaNosComentarios([c(3, 5, true, "2026-09-28T15:10:00Z", "Stop promotions")], usuarios, desde, 1);
  assert.equal(r?.pedidoDeSaida, true);
});
