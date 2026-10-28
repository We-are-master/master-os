/**
 * Scope formal da fatura: só o WORK, sem preço, acesso ou contato.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { escopoDaFatura } from "./invoice-scope";

test("scope no padrão: só as tarefas do WORK", () => {
  const scope = [
    "WORK",
    "- Free and open a stuck window.",
    "- Check the hinges or runners.",
    "",
    "ACCESS",
    "Key safe code 1234.",
    "",
    "NOTES",
    'In the customer\'s words: "window stuck"',
  ].join("\n");
  assert.deepEqual(escopoDaFatura(scope), ["Free and open a stuck window.", "Check the hinges or runners."]);
});

test("padrão sem WORK: a fatura não mostra a seção", () => {
  assert.deepEqual(escopoDaFatura("PROPERTY\nFlat · 1 bed"), []);
});

test("vazio ou nulo: nada", () => {
  assert.deepEqual(escopoDaFatura(null), []);
  assert.deepEqual(escopoDaFatura("   "), []);
});

test("preço nunca aparece, mesmo se ficou gravado no scope", () => {
  assert.deepEqual(escopoDaFatura("WORK\n- Paint the hallway (fixed £180, tools included).\n- Fill holes."), ["Paint the hallway.", "Fill holes."]);
});

test("scope antigo, texto solto: tarefas sim, acesso e telefone não", () => {
  const scope = "Replace kitchen tap\nRegrout shower\nAccess: tenant will let in\nContact: Jane 07700 900123";
  assert.deepEqual(escopoDaFatura(scope), ["Replace kitchen tap", "Regrout shower"]);
});

test("linha comprida é cortada e repetida sai", () => {
  const longa = `Fit ${"shelf ".repeat(60)}`;
  const r = escopoDaFatura(`WORK\n- ${longa}\n- Fill holes.\n- Fill holes.`);
  assert.equal(r.length, 2);
  assert.ok(r[0]!.endsWith("…") && r[0]!.length <= 220);
});

test("referência interna de merge sai", () => {
  assert.deepEqual(escopoDaFatura("WORK\n- Painting works (merged from JOB-9717)."), ["Painting works."]);
});
