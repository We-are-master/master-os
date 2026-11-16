import { test } from "node:test";
import assert from "node:assert/strict";
import { fichaDoFormulario, idsDoWebhook, lerCampos, type LeadDaMeta } from "./formulario";
import { eventoDeCompra } from "./compra-do-formulario";
import { externalIdDoLead } from "../harvey-wa/primeiro-contato";

test("lê as perguntas padrão da Meta e o serviço de múltipla escolha", () => {
  const c = lerCampos([
    { name: "full_name", values: ["Sarah Jones"] },
    { name: "phone_number", values: ["+447700900123"] },
    { name: "email", values: ["Sarah@Example.com"] },
    { name: "post_code", values: ["sw11 2ab"] },
    { name: "which_service_do_you_need?", values: ["end_of_tenancy_clean"] },
    { name: "when", values: ["this_week"] },
  ]);
  assert.equal(c.nome, "Sarah Jones");
  assert.equal(c.telefone, "+447700900123");
  assert.equal(c.email, "sarah@example.com");
  assert.equal(c.postcode, "SW11 2AB");
  assert.equal(c.servico, "end of tenancy clean");
  assert.deepEqual(c.extras, [["when", "this week"]]);
});

test("sem pergunta de serviço e com e-mail inválido", () => {
  const c = lerCampos([{ name: "first_name", values: ["Tom"] }, { name: "last_name", values: ["Lee"] }, { name: "email", values: ["nope"] }]);
  assert.equal(c.nome, "Tom Lee");
  assert.equal(c.email, null);
  assert.equal(c.servico, "your job");
});

test("pega só os ids de leadgen do webhook da página", () => {
  const ids = idsDoWebhook({
    object: "page",
    entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "123" } }, { field: "feed", value: {} }, { field: "leadgen", value: { leadgen_id: "123" } }] }],
  });
  assert.deepEqual(ids, ["123"]);
});

test("ticket do formulário tem external_id próprio, Checkatrade continua igual", () => {
  assert.equal(externalIdDoLead("meta:987"), "meta-lead:987");
  assert.equal(externalIdDoLead("abc"), "checkatrade-lead:abc");
});

test("ficha leva a mensagem enviada e o anúncio", () => {
  const lead: LeadDaMeta = {
    leadgenId: "1", criadoEm: null, adId: "9", adName: "EoT video", adsetId: null, campaignId: null, campaignName: "B2C form",
    formId: null, plataforma: "ig", nome: "Sarah Jones", telefone: "07700900123", email: null, postcode: null, servico: "deep clean", extras: [],
  };
  const f = fichaDoFormulario(lead, "+447700900123", "enviado", null);
  assert.match(f, /Hi Sarah, thanks for your Fixfy request for deep clean/);
  assert.match(f, /Ad: EoT video/);
  assert.match(f, /wa\.me\/447700900123/);
});

test("compra vai com lead_id, valor e o event_id do site", () => {
  const e = eventoDeCompra({ leadgenId: "555", referencia: "JOB-9800", valor: 223, telefone: "+44 7700 900123", email: "a@b.com" }) as {
    event_id: string; action_source: string; user_data: { lead_id: string; ph: string[]; em: string[] }; custom_data: { value: number; currency: string };
  };
  assert.equal(e.event_id, "Purchase-JOB-9800");
  assert.equal(e.action_source, "system_generated");
  assert.equal(e.user_data.lead_id, "555");
  assert.equal(e.user_data.ph[0].length, 64);
  assert.equal(e.custom_data.value, 223);
  assert.equal(e.custom_data.currency, "GBP");
});
