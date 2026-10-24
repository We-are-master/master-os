import { test } from "node:test";
import assert from "node:assert/strict";
import { esperaHumana, faltaEsperar, tempoDigitando, TETO_DA_ESPERA_MS } from "./ritmo";

const livre = { sorteioOcupado: 1 };

test("curta 25 a 40 s, média 35 a 55 s, longa 50 a 70 s", () => {
  assert.equal(esperaHumana({ caracteres: 40, sorteio: 0, ...livre }), 25_000);
  assert.equal(esperaHumana({ caracteres: 40, sorteio: 1, ...livre }), 40_000);
  assert.equal(esperaHumana({ caracteres: 200, sorteio: 0, ...livre }), 35_000);
  assert.equal(esperaHumana({ caracteres: 200, sorteio: 1, ...livre }), 55_000);
  assert.equal(esperaHumana({ caracteres: 400, sorteio: 0, ...livre }), 50_000);
  assert.equal(esperaHumana({ caracteres: 400, sorteio: 1, ...livre }), 70_000);
});

test("primeira resposta ao lead: 40 a 70 s, e nunca 'ocupado'", () => {
  assert.equal(esperaHumana({ caracteres: 40, primeiraResposta: true, sorteio: 0, sorteioOcupado: 0 }), 40_000);
  assert.equal(esperaHumana({ caracteres: 40, primeiraResposta: true, sorteio: 1, sorteioOcupado: 0 }), 70_000);
});

test("foto ou vídeo soma 15 s", () => {
  assert.equal(esperaHumana({ caracteres: 200, temMidia: true, sorteio: 0, ...livre }), 50_000);
});

test("conversa quente fica 25% mais rápida", () => {
  assert.equal(esperaHumana({ caracteres: 40, quente: true, sorteio: 0, ...livre }), 18_750);
});

test("ocupado com outro cliente: 1 em 5, mais 30 a 60 s", () => {
  assert.equal(esperaHumana({ caracteres: 40, sorteio: 0, sorteioOcupado: 0 }), 55_000);
  assert.equal(esperaHumana({ caracteres: 40, sorteio: 0, sorteioOcupado: 0.1 }), 70_000);
  assert.equal(esperaHumana({ caracteres: 40, sorteio: 0, sorteioOcupado: 0.2 }), 25_000);
});

test("fechamento nunca passa de 35 s, nem ocupado", () => {
  assert.equal(esperaHumana({ caracteres: 400, fechamento: true, sorteio: 1, sorteioOcupado: 0 }), 35_000);
  assert.equal(esperaHumana({ caracteres: 40, fechamento: true, sorteio: 0, sorteioOcupado: 0 }), 25_000);
});

test("teto de 2 minutos", () => {
  assert.equal(esperaHumana({ caracteres: 400, temMidia: true, sorteio: 1, sorteioOcupado: 0.19 }), TETO_DA_ESPERA_MS);
});

test("digitando só no fim, proporcional ao texto", () => {
  assert.equal(tempoDigitando(100, 60_000), 10_000);
  assert.equal(tempoDigitando(2_000, 30_000), 30_000);
});

test("o tempo que já passou é descontado", () => {
  assert.equal(faltaEsperar(35_000, 9_000), 26_000);
  assert.equal(faltaEsperar(35_000, 40_000), 0);
  assert.equal(faltaEsperar(500_000, 10_000), TETO_DA_ESPERA_MS - 10_000);
});
