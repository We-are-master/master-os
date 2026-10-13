import { test } from "node:test";
import assert from "node:assert/strict";
import { limparCopias } from "./invoice-account-cc";

test("o financeiro da conta entra em cópia", () => {
  assert.deepEqual(limparCopias(["markogatzouris@lifung.com"], ["sabrinabraz@lifung.com"]), ["markogatzouris@lifung.com"]);
});

test("quem já é o destinatário não entra de novo, nem com outra caixa de letra", () => {
  assert.deepEqual(limparCopias(["SabrinaBraz@lifung.com", "finance@lifung.com"], ["sabrinabraz@lifung.com"]), ["finance@lifung.com"]);
});

test("lixo e repetido ficam de fora", () => {
  assert.deepEqual(limparCopias(["a@b.com", "A@B.com", "sem arroba", "", null, " c@d.co.uk "]), ["a@b.com", "c@d.co.uk"]);
});

test("coluna vazia ou ausente não copia ninguém", () => {
  assert.deepEqual(limparCopias(null), []);
  assert.deepEqual(limparCopias(undefined), []);
  assert.deepEqual(limparCopias("a@b.com"), []);
});
