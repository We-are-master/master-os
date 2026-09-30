import { test } from "node:test";
import assert from "node:assert/strict";
import { origemDaConversa, origemDoLead } from "./origem";

test("mensagem pronta de cada anúncio vira conjunto e criativo", () => {
  assert.deepEqual(origemDaConversa("Hi there! Is the deep clean offer still available? (from £174)"), { campanha: "wa_cleaning", conteudo: "cl_deep" });
  assert.deepEqual(origemDaConversa("Hi there! Is the end of tenancy clean offer still available? (from £200)"), { campanha: "wa_cleaning", conteudo: "cl_eot" });
  assert.deepEqual(origemDaConversa("Hi there! Is the handyman offer still available? (half day £180)"), { campanha: "wa_maintenance", conteudo: "mt_handyman" });
  assert.deepEqual(origemDaConversa("Hi there! Is the painter offer still available? (touch-ups £215)"), { campanha: "wa_maintenance", conteudo: "mt_paint" });
});

test("cliente que mexeu pouco no texto ainda conta", () => {
  assert.deepEqual(origemDaConversa("hi is the Handyman offer still available"), { campanha: "wa_maintenance", conteudo: "mt_handyman" });
});

test("conversa que não veio de anúncio fica sem origem", () => {
  assert.equal(origemDaConversa("Hello, how much for an end of tenancy clean?"), null);
  assert.equal(origemDaConversa("I need a painter"), null);
  assert.equal(origemDaConversa(""), null);
  assert.equal(origemDaConversa(null), null);
});

test("origem gravada no lead volta igual", () => {
  assert.deepEqual(origemDoLead({ utm_source: "whatsapp", utm_campaign: "wa_cleaning", utm_content: "cl_eot" }), { campanha: "wa_cleaning", conteudo: "cl_eot" });
  assert.deepEqual(origemDoLead({ utm_campaign: "wa_v1" }), { campanha: "wa_v1", conteudo: null });
  assert.equal(origemDoLead(null), null);
  assert.equal(origemDoLead({}), null);
});
