import { test } from "node:test";
import assert from "node:assert/strict";
import { janelaParaOJob, precoConfere, precoNaMensagem, precosDaEquipe, ticketAntesDoPreco, valorEmLibras } from "./preco-da-equipe";
import type { Fala } from "./cerebro";

const conversa: Fala[] = [
  { papel: "cliente", texto: "I need 3 curtain poles put up. My budget is £50." },
  { papel: "harvey", texto: "That fits the 1 hour slot at £72 fixed." },
  { papel: "equipe", texto: "Hi Viviane, it's Leo here, We can do the job for £80,00. it's only necessary to put up the curtains?" },
  { papel: "cliente", texto: "At the moment yes" },
];

test("lê o valor como a equipe escreve", () => {
  assert.equal(valorEmLibras("90,00"), 90);
  assert.equal(valorEmLibras("80.50"), 80.5);
  assert.equal(valorEmLibras("1,450"), 1450);
  assert.equal(valorEmLibras("72"), 72);
  assert.equal(valorEmLibras("abc"), null);
});

test("só conta preço escrito pela equipe", () => {
  assert.deepEqual(precosDaEquipe(conversa), [80]);
});

test("o Harvey não cobra o que a equipe não deu", () => {
  assert.equal(precoConfere(80, conversa), true);
  assert.equal(precoConfere("80", conversa), true);
  assert.equal(precoConfere(72, conversa), false); // preço dele mesmo, do catálogo
  assert.equal(precoConfere(50, conversa), false); // o que o cliente queria pagar
  assert.equal(precoConfere(0, conversa), false);
});

test("vários preços da equipe: qualquer um deles vale, e só eles", () => {
  const c: Fala[] = [{ papel: "equipe", texto: "we can do the job £230 + the materials. 6 hours of work." }, { papel: "equipe", texto: "or £1,450 all in" }];
  assert.deepEqual(precosDaEquipe(c).sort((a, b) => a - b), [230, 1450]);
  assert.equal(precoConfere(1450, c), true);
  assert.equal(precoConfere(145, c), false);
});

test("a janela combinada vira o formato do job", () => {
  assert.equal(janelaParaOJob("9am to 12pm"), "09:00-12:00");
  assert.equal(janelaParaOJob("12pm - 3pm"), "12:00-15:00");
  assert.equal(janelaParaOJob("12 - 3pm"), "12:00-15:00");
  assert.equal(janelaParaOJob("09:00-12:00"), "09:00-12:00");
  assert.equal(janelaParaOJob("9 to 3pm"), "09:00-15:00");
  assert.equal(janelaParaOJob("morning"), null);
  assert.equal(janelaParaOJob("3pm to 9am"), null);
});

test("preço numa mensagem da equipe: vale o maior", () => {
  assert.deepEqual(precoNaMensagem("We can do it for £80,00."), { preco: 80, outros: [] });
  assert.deepEqual(precoNaMensagem("£80 labour + £20 materials = £100"), { preco: 100, outros: [80, 20] });
  assert.equal(precoNaMensagem("We'll send someone tomorrow"), null);
});

test("ticket antes do preço", () => {
  assert.equal(ticketAntesDoPreco(1, [1, 2]), true);
  assert.equal(ticketAntesDoPreco(null, [1, 2]), true);
  assert.equal(ticketAntesDoPreco(3, [1, 2]), false);
});
