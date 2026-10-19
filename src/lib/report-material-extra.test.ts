import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMaterialExtra, pendenciasDeMaterial } from "@/lib/report-material-extra";

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

it("pergunta de material: obrigatória, e Yes pede valor e recibo (19/10/2026)", () => {
  assert.deepEqual(pendenciasDeMaterial("general", {}), ["Answer: did you buy any materials for this job?"]);
  assert.deepEqual(pendenciasDeMaterial("general", { materials_bought: false }), []);
  assert.equal(pendenciasDeMaterial("general", { materials_bought: true }).length, 2);
  assert.deepEqual(pendenciasDeMaterial("general", { materials_bought: true, materials_extra_cost: 20 }), ["Photo of the receipt for the materials"]);
  assert.deepEqual(pendenciasDeMaterial("general", { materials_bought: true, materials_extra_cost: 20 }, 1), []);
  assert.deepEqual(pendenciasDeMaterial("cleaner", { materials_bought: true, materials_extra_cost: 20, materials_receipt: ["https://x/r.jpg"] }), []);
  assert.deepEqual(pendenciasDeMaterial("gardener", { materials_charges: false }), []);
  assert.deepEqual(pendenciasDeMaterial("certificate", {}), []);
});
