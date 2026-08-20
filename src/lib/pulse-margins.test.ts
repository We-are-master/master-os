import { strict as assert } from "node:assert";
import { test } from "node:test";
import { margemBruta, margemLiquida, margemPct } from "./pulse-margins";

/** Os números reais do Pulse em 20/08/2026, que foram o motivo do pedido. */
const PERIODO = { receita: 12059, custoOperacional: 7420, margemLiquidaGbp: 1952 };

test("as duas margens do período real batem com a conta à mão", () => {
  // Bruta: (12059 − 7420) / 12059 = 38,47% → 38
  assert.equal(margemBruta({ ...PERIODO, alvoPct: 40 }).pct, 38);
  // Líquida: 1952 / 12059 = 16,19% → 16
  assert.equal(margemLiquida({ ...PERIODO, alvoPct: 30 }).pct, 16);
});

test("período sem receita não tem margem zero, tem margem nenhuma", () => {
  // 0% num período vazio faz o card parecer alerta quando ele só está esperando
  // o primeiro job do mês.
  assert.equal(margemPct(0, 0), null);
  assert.equal(margemBruta({ receita: 0, custoOperacional: 0 }).pct, null);
  assert.equal(margemLiquida({ receita: 0, margemLiquidaGbp: 0 }).situacao, "sem_dado");
});

test("chegar perto da meta não é estar abaixo dela", () => {
  // 38 contra meta de 40 é 95% da meta. Pintar isso de vermelho todo mês ensina
  // o time a ignorar a cor.
  assert.equal(margemBruta({ ...PERIODO, alvoPct: 40 }).situacao, "no_alvo");
  // 16 contra 30 é metade: isso é abaixo de verdade.
  assert.equal(margemLiquida({ ...PERIODO, alvoPct: 30 }).situacao, "abaixo");
});

test("bater a meta é 'acima', e a conta usa o valor cru", () => {
  assert.equal(margemBruta({ receita: 100, custoOperacional: 55, alvoPct: 40 }).situacao, "acima");
  // 39,6% arredonda para 40 na tela, mas não bateu a meta de 40.
  const quase = margemBruta({ receita: 1000, custoOperacional: 604, alvoPct: 40 });
  assert.equal(quase.pct, 40);
  assert.equal(quase.situacao, "no_alvo");
});

test("prejuízo vira porcentagem negativa, não some", () => {
  const m = margemLiquida({ receita: 5000, margemLiquidaGbp: -450, alvoPct: 30 });
  assert.equal(m.pct, -9);
  assert.equal(m.situacao, "abaixo");
});

test("meta ausente cai no padrão do Setup", () => {
  assert.equal(margemBruta({ receita: 100, custoOperacional: 60 }).alvo, 40);
  assert.equal(margemLiquida({ receita: 100, margemLiquidaGbp: 30 }).alvo, 30);
});
