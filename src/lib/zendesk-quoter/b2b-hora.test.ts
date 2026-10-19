import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirPrecoHoraB2B, type ValorDoEmail } from "./b2b-hora";

const vazio: ValorDoEmail = {
  totalGbp: null, taxaHoraGbp: null, horas: null, extras: [],
  nomeDoCliente: "Sarah Jones", telefone: null, endereco: "14 Elm Road", postcode: "SW4 6QT", data: null, janela: null,
};

test("total escrito no e-mail vence tudo (já com extras)", () => {
  const d = decidirPrecoHoraB2B({ ...vazio, totalGbp: 214, horas: 2, extras: [{ item: "Parking", gbp: 15 }] }, 72, null);
  assert.equal(d.modo, "fixo");
  assert.equal(d.modo === "fixo" && d.total, 214);
});

test("extras com preço sem total: horas × taxa da conta + extras", () => {
  const d = decidirPrecoHoraB2B({ ...vazio, horas: 3, extras: [{ item: "Oven clean", gbp: 30 }] }, 72, null);
  assert.equal(d.modo, "fixo");
  assert.equal(d.modo === "fixo" && d.total, 246);
});

test("extras sem horas: pede ajuda, não chuta", () => {
  assert.equal(decidirPrecoHoraB2B({ ...vazio, extras: [{ item: "Oven clean", gbp: 30 }] }, 72, null).modo, "ajuda");
});

test("sem valor no e-mail: por hora na taxa da conta (o /api/jobs resolve)", () => {
  const d = decidirPrecoHoraB2B({ ...vazio }, 65, 2);
  assert.equal(d.modo, "hora");
  assert.equal(d.modo === "hora" && d.taxa, null);
  assert.equal(d.modo === "hora" && d.horas, 2);
});

test("taxa escrita no e-mail vai explícita", () => {
  const d = decidirPrecoHoraB2B({ ...vazio, taxaHoraGbp: 60 }, 72, null);
  assert.equal(d.modo === "hora" && d.taxa, 60);
});

test("conta sem taxa e e-mail sem valor: equipe", () => {
  assert.equal(decidirPrecoHoraB2B({ ...vazio }, null, 2).modo, "ajuda");
});
