import assert from "node:assert/strict";
import { test } from "node:test";
import { entradaPelaConta } from "./deposito-da-cotacao";

test("cliente sem conta: 50% do total", () => {
  assert.deepEqual(entradaPelaConta({ total: 240, entradaAtual: 0, percentualDaConta: null }), {
    deposit_percent: 50,
    deposit_required: 120,
  });
});

test("conta com 0% (Housekeep, Express): sem entrada", () => {
  assert.equal(entradaPelaConta({ total: 240, entradaAtual: 0, percentualDaConta: 0 }), null);
});

test("entrada já posta na cotação vale", () => {
  assert.equal(entradaPelaConta({ total: 240, entradaAtual: 60, percentualDaConta: 50 }), null);
});

test("arredonda em centavos", () => {
  assert.deepEqual(entradaPelaConta({ total: 99.99, entradaAtual: 0, percentualDaConta: 50 }), {
    deposit_percent: 50,
    deposit_required: 50,
  });
});

test("cotação sem valor não ganha entrada", () => {
  assert.equal(entradaPelaConta({ total: 0, entradaAtual: 0, percentualDaConta: 50 }), null);
});
