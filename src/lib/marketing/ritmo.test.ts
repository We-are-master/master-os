import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  aberturaDoWhatsApp,
  diaDoLembrete,
  ehDiaDoLembrete,
  emailNaJanela,
  horarioDoFollowup,
  horarioDoLembrete,
  lembretePassou,
  quandoEmLondres,
  whatsappNaJanela,
} from "./ritmo";
import { campanhaNaJanela } from "./campanha";

const d = (iso: string) => new Date(iso);
const iso = (x: Date) => x.toISOString();

test("e-mail só de manhã: 9h às 12h de Londres, no BST", () => {
  assert.equal(emailNaJanela(d("2026-09-29T07:59:00Z")), false); // 08:59 BST
  assert.equal(emailNaJanela(d("2026-09-29T08:00:00Z")), true); // 09:00 BST
  assert.equal(emailNaJanela(d("2026-09-29T10:59:00Z")), true); // 11:59 BST
  assert.equal(emailNaJanela(d("2026-09-29T11:00:00Z")), false); // 12:00 BST
  assert.equal(emailNaJanela(d("2026-09-29T14:00:00Z")), false); // 15:00 BST: é do WhatsApp
});

test("e-mail só de manhã também depois de 25/10, no GMT", () => {
  assert.equal(emailNaJanela(d("2026-10-27T08:30:00Z")), false); // 08:30 GMT
  assert.equal(emailNaJanela(d("2026-10-27T09:00:00Z")), true); // 09:00 GMT
  assert.equal(emailNaJanela(d("2026-10-27T11:59:00Z")), true); // 11:59 GMT
  assert.equal(emailNaJanela(d("2026-10-27T12:00:00Z")), false); // 12:00 GMT
});

test("WhatsApp só de tarde: 15h às 18h de Londres, no BST e no GMT", () => {
  assert.equal(whatsappNaJanela(d("2026-09-29T13:59:00Z")), false); // 14:59 BST
  assert.equal(whatsappNaJanela(d("2026-09-29T14:00:00Z")), true); // 15:00 BST
  assert.equal(whatsappNaJanela(d("2026-09-29T16:59:00Z")), true); // 17:59 BST
  assert.equal(whatsappNaJanela(d("2026-09-29T17:00:00Z")), false); // 18:00 BST
  assert.equal(whatsappNaJanela(d("2026-09-29T09:00:00Z")), false); // 10:00 BST: é do e-mail
  assert.equal(whatsappNaJanela(d("2026-10-27T14:30:00Z")), false); // 14:30 GMT
  assert.equal(whatsappNaJanela(d("2026-10-27T15:00:00Z")), true); // 15:00 GMT
  assert.equal(whatsappNaJanela(d("2026-10-27T18:00:00Z")), false); // 18:00 GMT
});

test("a campanha fica parada entre as duas janelas", () => {
  assert.equal(campanhaNaJanela(d("2026-09-29T09:00:00Z")), true); // 10:00 BST, e-mail
  assert.equal(campanhaNaJanela(d("2026-09-29T12:00:00Z")), false); // 13:00 BST, ninguém
  assert.equal(campanhaNaJanela(d("2026-09-29T15:00:00Z")), true); // 16:00 BST, WhatsApp
});

test("janela vem do ambiente, e valor torto cai no padrão", () => {
  const antes = { abre: process.env.MARKETING_WA_ABRE, fecha: process.env.MARKETING_WA_FECHA };
  try {
    process.env.MARKETING_WA_ABRE = "14";
    assert.equal(whatsappNaJanela(d("2026-09-29T13:30:00Z")), true); // 14:30 BST
    process.env.MARKETING_WA_ABRE = "";
    process.env.MARKETING_WA_FECHA = "tarde";
    assert.equal(whatsappNaJanela(d("2026-09-29T13:30:00Z")), false);
    assert.equal(whatsappNaJanela(d("2026-09-29T16:30:00Z")), true); // 17:30 BST
  } finally {
    if (antes.abre === undefined) delete process.env.MARKETING_WA_ABRE; else process.env.MARKETING_WA_ABRE = antes.abre;
    if (antes.fecha === undefined) delete process.env.MARKETING_WA_FECHA; else process.env.MARKETING_WA_FECHA = antes.fecha;
  }
});

test("follow-up às 15h de Londres do mesmo dia do e-mail", () => {
  assert.equal(iso(horarioDoFollowup(d("2026-09-29T08:15:00Z"))), "2026-09-29T14:00:00.000Z"); // 09:15 BST → 15:00 BST
  assert.equal(iso(horarioDoFollowup(d("2026-09-29T10:59:00Z"))), "2026-09-29T14:00:00.000Z"); // 11:59 BST, 3h01 depois
  assert.equal(iso(horarioDoFollowup(d("2026-10-27T09:15:00Z"))), "2026-10-27T15:00:00.000Z"); // GMT
  assert.equal(iso(horarioDoFollowup(d("2026-10-25T09:00:00Z"))), "2026-10-25T15:00:00.000Z"); // dia da troca, já GMT
});

test("e-mail forçado tarde demais: follow-up vai para as 15h do dia seguinte", () => {
  assert.equal(iso(horarioDoFollowup(d("2026-09-29T15:00:00Z"))), "2026-09-30T14:00:00.000Z"); // 16:00 BST
  assert.equal(iso(horarioDoFollowup(d("2026-09-29T11:30:00Z"))), "2026-09-30T14:00:00.000Z"); // 12:30 BST, menos de 3h
  assert.equal(iso(horarioDoFollowup(d("2026-10-24T15:00:00Z"))), "2026-10-25T15:00:00.000Z"); // sáb 16:00 BST → dom 15:00 GMT
});

test("oferta liberada vai para a próxima abertura do WhatsApp", () => {
  assert.equal(iso(aberturaDoWhatsApp(d("2026-09-28T20:00:00Z"))), "2026-09-29T14:00:00.000Z"); // seg 21:00 → ter 15:00 BST
  assert.equal(iso(aberturaDoWhatsApp(d("2026-09-29T09:00:00Z"))), "2026-09-29T14:00:00.000Z"); // ter 10:00 → ter 15:00
  assert.equal(iso(aberturaDoWhatsApp(d("2026-09-29T15:00:00Z"))), "2026-09-29T14:00:00.000Z"); // ter 16:00, janela aberta: já vale
  assert.equal(iso(aberturaDoWhatsApp(d("2026-09-29T17:30:00Z"))), "2026-09-30T14:00:00.000Z"); // ter 18:30 → qua 15:00
  assert.equal(iso(aberturaDoWhatsApp(d("2026-10-27T19:00:00Z"))), "2026-10-28T15:00:00.000Z"); // GMT
});

test("lembrete: quinta 01/10 às 9h30 de Londres, e só naquele dia", () => {
  assert.equal(diaDoLembrete(), "2026-10-01");
  assert.equal(iso(horarioDoLembrete()), "2026-10-01T08:30:00.000Z");
  assert.equal(ehDiaDoLembrete(d("2026-09-30T22:59:00Z")), false); // qua 23:59 BST
  assert.equal(ehDiaDoLembrete(d("2026-09-30T23:30:00Z")), true); // qui 00:30 BST
  assert.equal(lembretePassou(d("2026-10-01T22:59:00Z")), false); // qui 23:59 BST
  assert.equal(lembretePassou(d("2026-10-01T23:00:00Z")), true); // sex 00:00 BST
});

test("hora de Londres legível para a nota do ticket", () => {
  assert.equal(quandoEmLondres(d("2026-09-29T08:15:00Z")), "Tue 29/09 09:15");
  assert.equal(quandoEmLondres(d("2026-10-27T15:05:00Z")), "Tue 27/10 15:05");
});
