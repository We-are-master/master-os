import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMaterialExtra } from "@/lib/report-material-extra";

/**
 * A regra que transforma material do report em dinheiro do job: custo reembolsa
 * o parceiro, cobrança em branco vira custo + 30% (política da casa, a mesma do
 * supplier_prices). Explícito ganha do padrão; lixo vira zero, nunca NaN.
 */
describe("material do report", () => {
  it("só o custo preenchido: cliente paga custo + 30%", () => {
    assert.deepEqual(parseMaterialExtra({ materials_extra_cost: 40 }), { cost: 40, charge: 52 });
  });

  it("cobrança explícita ganha do padrão de 30%", () => {
    assert.deepEqual(
      parseMaterialExtra({ materials_extra_cost: 40, materials_extra_charge: 60 }),
      { cost: 40, charge: 60 },
    );
  });

  it("cobrança sem custo vale sozinha (material que a gente forneceu)", () => {
    assert.deepEqual(parseMaterialExtra({ materials_extra_charge: 25 }), { cost: 0, charge: 25 });
  });

  it("string numérica do form funciona, e o 30% arredonda em 2 casas", () => {
    assert.deepEqual(parseMaterialExtra({ materials_extra_cost: "33.33" }), {
      cost: 33.33,
      charge: 43.33,
    });
  });

  it("vazio, lixo e negativo viram zero — nunca NaN no dinheiro", () => {
    assert.deepEqual(parseMaterialExtra(null), { cost: 0, charge: 0 });
    assert.deepEqual(parseMaterialExtra({}), { cost: 0, charge: 0 });
    assert.deepEqual(
      parseMaterialExtra({ materials_extra_cost: "abc", materials_extra_charge: -5 }),
      { cost: 0, charge: 0 },
    );
  });
});
