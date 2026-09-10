import { test } from "node:test";
import assert from "node:assert/strict";
import { montarEmailDaQuote } from "./quote-email-cliente";

test("o lance real da QT-2026-1139 vira o e-mail do dono", () => {
  const r = montarEmailDaQuote({ scope: "Repair and repaint the stained areas.", labourCost: 300, materialsCost: 80, margem: 40 })!;
  assert.equal(r.labour, 500);
  assert.equal(r.materials, 133.33);
  assert.equal(r.total, 633.33);
  assert.match(r.corpo, /^Hi Team,\n\nPlease see the quote below:/);
  assert.match(r.corpo, /Materials: £133\.33\nLabour: £500\.00\nTotal Price inc VAT: £633\.33/);
  assert.match(r.corpo, /Thank you$/);
});

test("as linhas somam o total escrito, do jeito que o cliente confere", () => {
  const r = montarEmailDaQuote({ scope: "x", labourCost: 333.33, materialsCost: 66.66, margem: 40 })!;
  assert.equal(Math.round((r.labour + r.materials) * 100) / 100, r.total);
});

test("sem material o parceiro nao tem o valor rachado por nossa conta", () => {
  const r = montarEmailDaQuote({ scope: "x", labourCost: 380, materialsCost: 0, margem: 40 })!;
  assert.equal(r.materials, 0);
  assert.equal(r.total, 633.33);
});

test("lance sem valor nenhum nao vira e-mail", () => {
  assert.equal(montarEmailDaQuote({ scope: "x", labourCost: 0, materialsCost: 0, margem: 40 }), null);
});

test("margem zero devolve o custo do parceiro", () => {
  const r = montarEmailDaQuote({ scope: "x", labourCost: 300, materialsCost: 80, margem: 0 })!;
  assert.equal(r.total, 380);
});

import { lerPayloadDoLance } from "./quote-email-cliente";

test("le o BID_JSON real do lance de 380 da G&M Services", () => {
  const cru = 'BID_JSON:{"labour_cost":300,"materials_cost":80,"materials_description":"Tampa manchas , tinta , massa corrida tinta normal , lixas","labour_pricing":"fixed","materials_pricing":"unit","start_date_option_1":"2026-09-08"}\n\n380';
  const r = lerPayloadDoLance(cru);
  assert.equal(r.labourCost, 300);
  assert.equal(r.materialsCost, 80);
  assert.equal(r.materialsDescription, "Tampa manchas , tinta , massa corrida tinta normal , lixas");
  assert.equal(r.labourDescription, null);
});

test("lance sem BID_JSON nao explode, devolve zeros", () => {
  assert.deepEqual(lerPayloadDoLance("só um texto solto"), { labourCost: 0, materialsCost: 0, labourDescription: null, materialsDescription: null });
  assert.deepEqual(lerPayloadDoLance(null), { labourCost: 0, materialsCost: 0, labourDescription: null, materialsDescription: null });
});

test("BID_JSON quebrado nao derruba a varredura", () => {
  assert.equal(lerPayloadDoLance("BID_JSON:{isso nao e json}").labourCost, 0);
});
