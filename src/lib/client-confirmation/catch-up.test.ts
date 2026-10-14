/**
 * A varredura de recuperação: quem ela pergunta, e que o ensaio é só leitura.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { classificarEnsaio, dentroDaJanelaDaRecuperacao, recuperarConfirmacoes } from "./catch-up";
import { fakeSupabase } from "./fake-supabase.test-helper";

const AGORA = new Date("2026-10-14T11:00:00Z"); // 12h de Londres

function job(id: string, extra: Record<string, unknown>) {
  return {
    id, reference: `JOB-${id}`, title: "General Maintenance", status: "scheduled", partner_id: "p-1",
    scheduled_date: "2026-10-16", scheduled_start_at: "2026-10-16T08:00:00Z", scheduled_end_at: "2026-10-16T11:00:00Z",
    client_id: "cli-1", client_name: "Kate", client_confirmation_sent_at: null, client_reminder_sent_at: null,
    deleted_at: null, ...extra,
  };
}

function banco() {
  return fakeSupabase({
    jobs: [
      job("1", {}),
      job("2", { scheduled_date: "2026-10-14" }), // hoje: fora
      job("3", { partner_id: null }), // sem parceiro: fora
      job("4", { client_reminder_sent_at: "2026-10-15T17:00:00Z" }), // lembrete já saiu
      job("5", { status: "cancelled" }),
      job("6", { client_confirmation_sent_at: "2026-10-10T10:00:00Z" }),
    ],
    clients: [{ id: "cli-1", full_name: "Kate Allen", phone: "+44 7896 710967", source_account_id: "acc-fixfy" }],
    accounts: [{ id: "acc-fixfy", company_name: "Fixfy", client_confirmation_whatsapp: true }],
  });
}

const ENV = ["CLIENT_MESSAGING_ENABLED", "SUNSHINE_APP_ID", "SUNSHINE_KEY_ID", "SUNSHINE_KEY_SECRET", "FIXFY_AGENT_MODEL"];
let salvo: Record<string, string | undefined> = {};

describe("recuperarConfirmacoes", () => {
  beforeEach(() => {
    salvo = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    process.env.CLIENT_MESSAGING_ENABLED = "1";
    process.env.SUNSHINE_APP_ID = "a"; process.env.SUNSHINE_KEY_ID = "b"; process.env.SUNSHINE_KEY_SECRET = "c";
    delete process.env.FIXFY_AGENT_MODEL;
  });
  afterEach(() => {
    for (const k of ENV) { if (salvo[k] === undefined) delete process.env[k]; else process.env[k] = salvo[k]; }
  });

  test("só job de amanhã em diante, com parceiro, sem confirmação e sem lembrete", async () => {
    const { client, escritas } = banco();
    const r = await recuperarConfirmacoes(client, { agora: AGORA });
    assert.equal(r.modo, "ensaio");
    assert.deepEqual(r.linhas.map((l) => l.reference), ["JOB-1"]);
    assert.equal(r.linhas[0].resultado, "enviaria");
    assert.equal(escritas.length, 0, "ensaio é só leitura");
  });

  test("aplicando manda uma vez, e a segunda rodada não acha mais nada", async () => {
    const { client } = banco();
    let n = 0;
    const enviar = async (m: { to: string }) => { n++; return { messageId: "w", to: m.to }; };
    const r1 = await recuperarConfirmacoes(client, { agora: AGORA, aplicar: true, enviar });
    assert.equal(r1.modo, "envio");
    assert.equal(r1.linhas[0].resultado, "enviado");
    const r2 = await recuperarConfirmacoes(client, { agora: AGORA, aplicar: true, enviar });
    assert.equal(r2.linhas.length, 0);
    assert.equal(n, 1);
  });

  test("sem CLIENT_MESSAGING_ENABLED, --aplicar vira ensaio com aviso", async () => {
    delete process.env.CLIENT_MESSAGING_ENABLED;
    const { client, escritas } = banco();
    const r = await recuperarConfirmacoes(client, { agora: AGORA, aplicar: true });
    assert.equal(r.modo, "ensaio");
    assert.match(String(r.aviso), /CLIENT_MESSAGING_ENABLED/);
    assert.equal(escritas.length, 0);
  });

  test("fora das 9h-20h de Londres só lista", async () => {
    const { client } = banco();
    const r = await recuperarConfirmacoes(client, { agora: new Date("2026-10-14T21:00:00Z"), aplicar: true });
    assert.equal(r.modo, "ensaio");
    assert.match(String(r.aviso), /London/);
  });

  test("janela e classificação", () => {
    assert.equal(dentroDaJanelaDaRecuperacao(AGORA), true);
    assert.equal(dentroDaJanelaDaRecuperacao(new Date("2026-10-14T06:00:00Z")), false);
    assert.equal(classificarEnsaio("dry run: would send booking_confirmation → x"), "enviaria");
    assert.equal(classificarEnsaio("Li & Fung does not send client confirmations"), "pulado");
  });
});
