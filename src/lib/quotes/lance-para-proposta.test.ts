import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decidirEnvioDoLance, precoDeVendaDoLance } from "./lance-para-proposta";

const COMPLETO = { venda: 400, limite: 600, temEndereco: true, temEscopo: true, temFotos: true, temEmail: true, jaTinhaParceiro: false };

describe("bid → proposal", () => {
  it("sells at 30% margin, rounded up to £5", () => {
    assert.equal(precoDeVendaDoLance(280), 400);
    assert.equal(precoDeVendaDoLance(100), 145);
    const venda = precoDeVendaDoLance(333);
    assert.ok((venda - 333) / venda >= 0.3);
  });

  it("goes out on its own only with full context and under the limit", () => {
    assert.deepEqual(decidirEnvioDoLance(COMPLETO), { auto: true, motivos: [] });
    assert.equal(decidirEnvioDoLance({ ...COMPLETO, venda: 900 }).auto, false);
    assert.deepEqual(decidirEnvioDoLance({ ...COMPLETO, temFotos: false, temEmail: false }).motivos, ["no photos", "no customer email"]);
    assert.equal(decidirEnvioDoLance({ ...COMPLETO, jaTinhaParceiro: true }).auto, false);
  });
});
