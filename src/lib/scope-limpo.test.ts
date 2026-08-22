import { strict as assert } from "node:assert";
import { test } from "node:test";
import { limparScope } from "./scope-limpo";

test("horario solto sai, texto de trabalho fica", () => {
  // JOB-9478 nasceu assim: a hora da mensagem no card virou linha do scope.
  const r = limparScope("Job: Bathroom Tap Replacement\n\n10:36\nReplace tap\n\nI have replacement tap already");
  assert.ok(!r!.includes("10:36"));
  assert.ok(r!.includes("Replace tap"));
  assert.ok(r!.includes("I have replacement tap already"));
});

test("varios formatos de hora solta", () => {
  for (const h of ["08:56", "9:05 am", "13.55", "6:36PM"]) {
    assert.equal(limparScope(`${h}\nfix the door`), "fix the door", `nao tirou "${h}"`);
  }
});

test("hora dentro de uma frase de trabalho nao e tocada", () => {
  const r = limparScope("Customer asks us to arrive after 10:36 because of the school run");
  assert.ok(r!.includes("10:36"));
});

test("data e janela repetidas saem: o job ja tem esses campos", () => {
  // Repetidas no texto elas envelhecem na primeira remarcacao.
  const r = limparScope("Job details\n\nJob: Handyman\nVisit date: Monday, 24 August 2026\nBooked arrival time: 09:00 - 12:00\nTasks: replace door handles x3");
  assert.ok(!r!.includes("24 August"));
  assert.ok(!r!.includes("09:00"));
  assert.ok(r!.includes("Tasks: replace door handles x3"));
  assert.ok(r!.includes("Job: Handyman"));
});

test("manterJanela guarda data e janela, e ainda tira o resto", () => {
  // O backfill usa isto: para job antigo aquela linha e o unico registro do
  // que a plataforma prometeu, e 46 deles discordam do campo do job.
  const r = limparScope("10:36\nVisit date: Monday, 24 August 2026\nBooked arrival time: 09:00 - 12:00\nHousekeep job\nReplace tap", { manterJanela: true });
  assert.ok(r!.includes("Visit date: Monday, 24 August 2026"));
  assert.ok(r!.includes("Booked arrival time: 09:00 - 12:00"));
  assert.ok(!r!.includes("10:36"));
  assert.ok(!r!.includes("Housekeep"));
});

test("nome de plataforma leva a linha inteira junto", () => {
  // Apagar so a palavra deixaria uma frase quebrada que ninguem entende.
  const r = limparScope("This is a Checkatrade Express job. We told the customer that a trade will call.\nHang a mirror in the hallway.");
  assert.equal(r, "Hang a mirror in the hallway.");
});

test("todas as plataformas da lista, em qualquer caixa", () => {
  for (const n of ["Housekeep", "FANTASTIC SERVICES", "homyze", "Kvadrat", "Li & Fung", "The Stylesmiths"]) {
    assert.equal(limparScope(`${n} booking reference 123\nPaint the bedroom`), "Paint the bedroom", `deixou passar "${n}"`);
  }
});

test("o nome da propria conta pode ser passado a mais", () => {
  assert.equal(limparScope("Sent by Acme Lettings\nFix the tap", { nomesProibidos: ["Acme Lettings"] }), "Fix the tap");
});

test("o marcador de cobertura fica: e ele que prova o lead no reconcile", () => {
  const r = limparScope("checkatrade-lead:8827\n\nEnquiry about a leaking tap");
  assert.ok(r!.includes("checkatrade-lead:8827"));
});

test("nome curto demais nao vira filtro", () => {
  // Um nome de dois caracteres casaria em metade do texto.
  assert.equal(limparScope("Fit a new lock", { nomesProibidos: ["AB", ""] }), "Fit a new lock");
});

test("linhas em branco colapsam e as pontas ficam limpas", () => {
  assert.equal(limparScope("\n\nFix the door\n\n\n\nPaint the wall\n\n"), "Fix the door\n\nPaint the wall");
});

test("scope que so tinha lixo vira nulo, nao string vazia", () => {
  assert.equal(limparScope("10:36\nVisit date: Monday\nHousekeep job"), null);
});

test("vazio e nulo passam sem quebrar", () => {
  assert.equal(limparScope(null), null);
  assert.equal(limparScope(undefined), null);
  assert.equal(limparScope(""), "");
});
