import { test } from "node:test";
import assert from "node:assert/strict";
import { esperaHumana, faltaEsperar, TETO_DA_ESPERA_MS } from "./ritmo";

const meio = { sorteio: 0.5 };

test("resposta curta sai em poucos segundos, nunca na hora", () => {
  const ms = esperaHumana({ caracteres: 20, ...meio });
  assert.ok(ms >= 6_000 && ms <= 8_000, String(ms));
});

test("resposta com preço e explicação leva o tempo de quem digitou", () => {
  assert.equal(esperaHumana({ caracteres: 200, ...meio }), 15_000);
  assert.equal(esperaHumana({ caracteres: 400, ...meio }), 24_000);
});

test("foto do cliente pede mais tempo", () => {
  assert.equal(esperaHumana({ caracteres: 200, temMidia: true, ...meio }) - esperaHumana({ caracteres: 200, ...meio }), 6_000);
});

test("a primeira resposta a um lead continua ágil", () => {
  assert.ok(esperaHumana({ caracteres: 600, temMidia: true, primeiraResposta: true, sorteio: 1 }) <= 18_000);
});

test("nunca passa do teto, por maior que seja a resposta", () => {
  assert.equal(esperaHumana({ caracteres: 5_000, sorteio: 1 }), TETO_DA_ESPERA_MS);
});

test("a espera varia, mas dentro de 20% para cada lado", () => {
  const a = esperaHumana({ caracteres: 200, sorteio: 0 }), b = esperaHumana({ caracteres: 200, sorteio: 1 });
  assert.equal(a, 12_000);
  assert.equal(b, 18_000);
});

test("o tempo que o modelo já gastou é descontado", () => {
  assert.equal(faltaEsperar(15_000, 9_000), 6_000);
  assert.equal(faltaEsperar(15_000, 20_000), 0);
  assert.equal(faltaEsperar(90_000, 10_000), TETO_DA_ESPERA_MS - 10_000);
});
