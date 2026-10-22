import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { canalAtivo, canalMudou, canaisParaEnviar, registrarCanalAtivo, canalAtivoDaQuote } from "./canal-ativo";
import { bancoFalso } from "./banco-falso-teste";

const FIXFY = "5cf896ec-ee42-441b-a698-34fdaeeb28b3";
const OUTRA = "aaaaaaaa-0000-0000-0000-000000000001";
const antes = process.env.PROCESSOS_V2;
afterEach(() => { if (antes === undefined) delete process.env.PROCESSOS_V2; else process.env.PROCESSOS_V2 = antes; });

function banco() {
  return bancoFalso({
    accounts: [
      { id: FIXFY, process_type: "direct", process_rules: { v2: true } },
      { id: OUTRA, process_type: "direct", process_rules: {} },
    ],
    clients: [
      { id: "c1", phone: "+44 7700900123", source_account_id: FIXFY, deleted_at: null },
      { id: "c2", phone: "+44 7700900999", source_account_id: OUTRA, deleted_at: null },
    ],
    quotes: [
      { id: "q1", client_id: "c1", source_account_id: null, status: "awaiting_customer", conversation_channel: null, external_source: "zendesk", external_ref: "501", deleted_at: null },
      { id: "q-fechada", client_id: "c1", source_account_id: null, status: "converted_to_job", conversation_channel: null, external_source: "zendesk", external_ref: "500", deleted_at: null },
      { id: "q2", client_id: "c2", source_account_id: null, status: "awaiting_customer", conversation_channel: null, external_source: "zendesk", external_ref: "502", deleted_at: null },
    ],
    jobs: [
      { id: "j1", client_id: "c1", account_id: FIXFY, status: "scheduled", conversation_channel: "email", external_source: "zendesk", external_ref: "601" },
      { id: "j-feito", client_id: "c1", account_id: FIXFY, status: "completed", conversation_channel: "email", external_source: "zendesk", external_ref: "602" },
    ],
  });
}

describe("canal ativo: partes puras", () => {
  it("só email e whatsapp contam", () => {
    assert.equal(canalAtivo({ conversation_channel: "WhatsApp" }), "whatsapp");
    assert.equal(canalAtivo({ conversation_channel: "sms" }), null);
    assert.equal(canalAtivo(null), null);
  });
  it("grava só quando muda", () => {
    assert.equal(canalMudou("email", "email"), false);
    assert.equal(canalMudou("email", "whatsapp"), true);
    assert.equal(canalMudou(null, "email"), true);
  });
  it("sem canal ativo: os canais de sempre; com canal: só ele", () => {
    assert.deepEqual(canaisParaEnviar(null, ["whatsapp", "email"]), ["whatsapp", "email"]);
    assert.deepEqual(canaisParaEnviar("email", ["whatsapp", "email"]), ["email"]);
    assert.deepEqual(canaisParaEnviar("whatsapp", ["email"]), []);
  });
});

describe("registrarCanalAtivo", () => {
  it("com PROCESSOS_V2 desligado nem lê o banco", async () => {
    delete process.env.PROCESSOS_V2;
    const b = banco();
    const r = await registrarCanalAtivo(b.sb, { telefone: "+447700900123" }, "whatsapp");
    assert.deepEqual(r.gravados, []);
    assert.equal(b.leituras.length, 0);
  });

  it("cliente troca de canal: WhatsApp e depois e-mail", async () => {
    process.env.PROCESSOS_V2 = "on";
    const b = banco();
    const r1 = await registrarCanalAtivo(b.sb, { telefone: "07700 900123" }, "whatsapp");
    assert.deepEqual(r1.gravados.sort(), ["job:j1", "quote:q1"]);
    assert.equal(await canalAtivoDaQuote(b.sb, "q1"), "whatsapp");
    // Fechados não mudam.
    assert.equal(b.tabelas.quotes!.find((q) => q.id === "q-fechada")!.conversation_channel, null);
    assert.equal(b.tabelas.jobs!.find((j) => j.id === "j-feito")!.conversation_channel, "email");

    const r2 = await registrarCanalAtivo(b.sb, { ticketId: 501 }, "email");
    assert.deepEqual(r2.gravados, ["quote:q1"]);
    assert.equal(await canalAtivoDaQuote(b.sb, "q1"), "email");

    // A mesma resposta de novo: nada a gravar.
    const r3 = await registrarCanalAtivo(b.sb, { ticketId: 501 }, "email");
    assert.deepEqual(r3.gravados, []);
  });

  it("conta sem regras.v2 fica como está", async () => {
    process.env.PROCESSOS_V2 = "on";
    const b = banco();
    const r = await registrarCanalAtivo(b.sb, { telefone: "+447700900999" }, "whatsapp");
    assert.deepEqual(r.gravados, []);
    assert.equal(b.tabelas.quotes!.find((q) => q.id === "q2")!.conversation_channel, null);
  });
});
