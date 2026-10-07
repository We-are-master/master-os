import { test } from "node:test";
import assert from "node:assert/strict";
import { telefoneE164 } from "./primeiro-contato";

test("telefone vira +44 do jeito que o Sunshine quer", () => {
  assert.equal(telefoneE164("07700 900123"), "+447700900123");
  assert.equal(telefoneE164("+44 7700 900123"), "+447700900123");
  assert.equal(telefoneE164("447700900123"), "+447700900123");
  assert.equal(telefoneE164("7700900123"), "+447700900123");
  assert.equal(telefoneE164("12345"), null);
  assert.equal(telefoneE164(null), null);
});

test("lead do site (sem marcador do Checkatrade) não recebe o template", async () => {
  const { decidirLead } = await import("./primeiro-contato");
  const d = decidirLead({ id: "x", full_name: "Sarah Jones", email: "s@x.com", phone: "07700900123", postcode: "NW5 1AB", address: null, notes: "Website lead" }, []);
  assert.equal(d.kind, "pular");
});

test("variáveis do template: padrão nome e tipo de trabalho; ordem configurável", async () => {
  const { variaveisDoTemplate } = await import("./primeiro-contato");
  const p = { nome: "Sarah", servico: "handyman work", area: "NW5 area" };
  delete process.env.HARVEY_WA_LEAD_TEMPLATE_VARS;
  assert.deepEqual(variaveisDoTemplate(p), ["Sarah", "handyman work"]);
  process.env.HARVEY_WA_LEAD_TEMPLATE_VARS = "nome,servico,area";
  assert.deepEqual(variaveisDoTemplate(p), ["Sarah", "handyman work", "NW5 area"]);
  delete process.env.HARVEY_WA_LEAD_TEMPLATE_VARS;
});
