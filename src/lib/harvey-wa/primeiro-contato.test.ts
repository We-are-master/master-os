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

const CATALOGO = [
  { id: "1", name: "General Maintenance", is_active: true, deleted_at: null, fixed_price: 90, hourly_rate: 0 },
  { id: "2", name: "Builder", is_active: true, deleted_at: null, fixed_price: 0, hourly_rate: 0 },
] as never;
const lead = (extra: Record<string, unknown>) => ({ id: "c1", full_name: "Todd Horabin", email: "todd@example.com", phone: "07700900123", postcode: "SW2 3HT", address: null, notes: "checkatrade-lead:abc123\nEnquiry · General Maintenance\nHandyman needed to fix a loose door handle", ...extra });

test("lead sem postcode recebe o template mesmo assim (o Harvey pergunta na conversa)", async () => {
  const { decidirLead } = await import("./primeiro-contato");
  const d = decidirLead(lead({ postcode: null }) as never, CATALOGO);
  assert.equal(d.kind, "mandar");
  if (d.kind === "mandar") assert.equal(d.contato.area, "London");
});

test("lead sem telefone e com e-mail vai por e-mail; sem os dois, é pulado", async () => {
  const { decidirLead } = await import("./primeiro-contato");
  const d = decidirLead(lead({ phone: null }) as never, CATALOGO);
  assert.equal(d.kind, "email");
  if (d.kind === "email") {
    assert.equal(d.contato.email, "todd@example.com");
    assert.equal(d.contato.nome, "Todd");
  }
  assert.equal(decidirLead(lead({ phone: null, email: null }) as never, CATALOGO).kind, "pular");
});

test("cliente sem nome é chamado de there, não de Unnamed", async () => {
  const { decidirLead } = await import("./primeiro-contato");
  const d = decidirLead(lead({ full_name: "Unnamed customer" }) as never, CATALOGO);
  assert.equal(d.kind === "mandar" && d.contato.nome, "there");
});

test("espelho em stud wall é handyman; construir stud wall é obra", async () => {
  const { matchService } = await import("@/lib/agent/sales/service-match");
  const espelho = matchService("2 mirrors that need putting up, careful as they are on stud wall", CATALOGO, "General Maintenance");
  assert.notEqual("service" in espelho ? espelho.service.name : "", "Builder");
  const obra = matchService("build a new stud wall to split the bedroom", CATALOGO, "General Maintenance");
  assert.equal("service" in obra ? obra.service.name : "", "Builder");
});
