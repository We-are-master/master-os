import { test } from "node:test";
import assert from "node:assert/strict";
import { lerResolucao, dataPorExtenso, JANELAS_EXIGIDAS } from "./job-on-hold-resolucao";

const HOJE = "2026-09-09";
const ok = (r: ReturnType<typeof lerResolucao>) => { assert.equal(r.ok, true); return (r as { ok: true; resolucao: never }).resolucao as never; };

test("voltar lá exige DUAS janelas, e uma só não passa", () => {
  const r = lerResolucao({ notes: "Vou refazer o rodapé", remedy: "revisit",
    offers: [{ date: "2026-09-12", slot: "morning" }] }, HOJE);
  assert.equal(r.ok, false);
  assert.match((r as { erros: string[] }).erros[0]!, /second window/);
});

test("duas janelas passam e saem ordenadas", () => {
  const r = lerResolucao({ notes: "Refaço a limpeza", remedy: "revisit", offers: [
    { date: "2026-09-15", slot: "afternoon" },
    { date: "2026-09-12", slot: "morning" },
  ]}, HOJE) as { ok: true; resolucao: { ofertas: Array<{ data: string; slot: string }> } };
  assert.equal(r.ok, true);
  assert.deepEqual(r.resolucao.ofertas, [
    { data: "2026-09-12", slot: "morning" },
    { data: "2026-09-15", slot: "afternoon" },
  ]);
});

test("a mesma data no mesmo turno não conta como duas", () => {
  const r = lerResolucao({ notes: "x", remedy: "revisit", offers: [
    { date: "2026-09-12", slot: "morning" },
    { date: "2026-09-12", slot: "morning" },
  ]}, HOJE);
  assert.equal(r.ok, false);
});

test("mesma data em turnos diferentes SÃO duas janelas", () => {
  const r = lerResolucao({ notes: "x", remedy: "revisit", offers: [
    { date: "2026-09-12", slot: "morning" },
    { date: "2026-09-12", slot: "afternoon" },
  ]}, HOJE) as { ok: true; resolucao: { ofertas: unknown[] } };
  assert.equal(r.ok, true);
  assert.equal(r.resolucao.ofertas.length, JANELAS_EXIGIDAS);
});

test("data no passado não vira janela", () => {
  const r = lerResolucao({ notes: "x", remedy: "revisit", offers: [
    { date: "2026-09-01", slot: "morning" },
    { date: "2026-09-12", slot: "morning" },
  ]}, HOJE);
  assert.equal(r.ok, false, "sobrou uma só depois de descartar o passado");
});

test("desconto não pede data nenhuma", () => {
  const r = lerResolucao({ notes: "Fica £40 de abatimento", remedy: "discount", discount_gbp: 40 }, HOJE) as
    { ok: true; resolucao: { descontoGbp: number; ofertas: unknown[] } };
  assert.equal(r.ok, true);
  assert.equal(r.resolucao.descontoGbp, 40);
  assert.deepEqual(r.resolucao.ofertas, []);
});

test("desconto aceita o valor escrito com libra e vírgula", () => {
  const r = lerResolucao({ notes: "x", remedy: "discount", discount_gbp: "£1,250.50" }, HOJE) as
    { ok: true; resolucao: { descontoGbp: number } };
  assert.equal(r.resolucao.descontoGbp, 1250.5);
});

test("desconto zero ou negativo é recusado", () => {
  assert.equal(lerResolucao({ notes: "x", remedy: "discount", discount_gbp: 0 }, HOJE).ok, false);
  assert.equal(lerResolucao({ notes: "x", remedy: "discount", discount_gbp: -10 }, HOJE).ok, false);
});

test("sem escolher o remédio, não há o que aplicar", () => {
  const r = lerResolucao({ notes: "vou ver isso" }, HOJE);
  assert.equal(r.ok, false);
  assert.match((r as { erros: string[] }).erros.join(" "), /go back or offer a discount/);
});

test("os erros voltam todos de uma vez, não um por vez", () => {
  const r = lerResolucao({ remedy: "revisit", offers: [] }, HOJE) as { ok: false; erros: string[] };
  assert.equal(r.ok, false);
  assert.equal(r.erros.length, 2, "faltou a nota E faltaram as janelas");
});

test("a data que o cliente lê tem dia da semana", () => {
  assert.equal(dataPorExtenso("2026-09-12"), "Saturday 12 September");
});

import { emailParaOCliente, notaDaResolucao } from "./job-on-hold-resolucao";

const REVISITA = { remedio: "revisit" as const, descontoGbp: null, notas: "Skirting was missed", ofertas: [
  { data: "2026-09-12", slot: "morning" as const }, { data: "2026-09-15", slot: "afternoon" as const },
]};
const DESCONTO = { remedio: "discount" as const, descontoGbp: 40, notas: "Can't get back this week", ofertas: [] };
const CTX = { referencia: "JOB-9600", endereco: "12 Onslow Road, TW10 6QH", parceiro: "G&M Services" };

test("o cliente recebe as duas janelas por extenso, para escolher", () => {
  const t = emailParaOCliente(REVISITA, CTX);
  assert.match(t, /1\. Saturday 12 September — Morning \(8am to 1pm\)/);
  assert.match(t, /2\. Tuesday 15 September — Afternoon \(1pm to 6pm\)/);
  assert.match(t, /Reply with the one that suits/);
});

test("desconto não promete visita nenhuma", () => {
  const t = emailParaOCliente(DESCONTO, CTX);
  assert.match(t, /£40\.00 reduction/);
  assert.doesNotMatch(t, /window|come back/i);
});

test("o nome do parceiro nunca vai ao cliente", () => {
  for (const r of [REVISITA, DESCONTO]) {
    assert.doesNotMatch(emailParaOCliente(r, CTX), /G&M/);
  }
});

test("mas a nota INTERNA nomeia o parceiro, que é quem o escritório cobra", () => {
  const n = notaDaResolucao(REVISITA, CTX);
  assert.match(n, /Partner: G&M Services/);
  assert.match(n, /Ready to send to the customer/);
  assert.match(n, /Skirting was missed/);
});
