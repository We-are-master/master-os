import { test } from "node:test";
import assert from "node:assert/strict";
import { nomeDeQuemLigou, sobreOQue } from "./ligacao-quote";

test("o serviço do ticket entra na frase quando a equipe marcou", () => {
  assert.equal(sobreOQue("General Maintenance"), "your general maintenance job");
});

test("sem serviço fica só o job", () => {
  assert.equal(sobreOQue(null), "your job");
  assert.equal(sobreOQue("  "), "your job");
});

test("quem tem nome é chamado pelo primeiro nome", () => {
  assert.equal(nomeDeQuemLigou("Sarah Jones"), "Sarah");
});

test("contato que é só o número vira there", () => {
  assert.equal(nomeDeQuemLigou("Caller +44 7700 900123"), "there");
  assert.equal(nomeDeQuemLigou("+447700900123"), "there");
  assert.equal(nomeDeQuemLigou(""), "there");
});
