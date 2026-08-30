import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sumJobsMoney } from "@/lib/job-financials";

/**
 * O total que aparece no rodapé das colunas E na barra de seleção. Os dois
 * lugares chamam esta função justamente para não poderem discordar: um total
 * que não bate com a coluna que ele soma é pior do que total nenhum.
 */
const j = (client_price: number, partner_cost: number, extras_amount = 0) =>
  ({ client_price, partner_cost, extras_amount }) as never;

describe("soma do dinheiro dos jobs", () => {
  it("soma as duas colunas e tira a margem", () => {
    // Os dois primeiros jobs do print: 93.00/55.80 e 95.50/57.30.
    const r = sumJobsMoney([j(93, 55.8), j(95.5, 57.3)]);
    assert.equal(r.revenue, 188.5);
    assert.equal(r.cost, 113.1);
    assert.equal(r.profit, 75.4);
    assert.equal(r.marginPct, 40);
  });

  it("extras entram na receita, como na coluna Job Amount", () => {
    const r = sumJobsMoney([j(100, 60, 20)]);
    assert.equal(r.revenue, 120);
    assert.equal(r.cost, 60);
    assert.equal(r.profit, 60);
  });

  it("centavos não escorrem: arredonda em 2 casas", () => {
    const r = sumJobsMoney([j(0.1, 0), j(0.2, 0)]);
    assert.equal(r.revenue, 0.3);
  });

  it("nada selecionado é zero, e zero não vira divisão por zero na margem", () => {
    const r = sumJobsMoney([]);
    assert.deepEqual(r, { revenue: 0, cost: 0, profit: 0, marginPct: 0 });
  });

  it("campo nulo conta como zero, nunca NaN no dinheiro da tela", () => {
    const r = sumJobsMoney([{ client_price: null, partner_cost: null, extras_amount: null } as never]);
    assert.equal(r.revenue, 0);
    assert.equal(r.cost, 0);
  });

  it("job no prejuízo mostra margem negativa em vez de esconder", () => {
    const r = sumJobsMoney([j(100, 130)]);
    assert.equal(r.profit, -30);
    assert.equal(r.marginPct, -30);
  });
});
