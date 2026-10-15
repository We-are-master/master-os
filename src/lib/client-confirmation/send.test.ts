/**
 * O portão que separa "job existe" de "job vai acontecer", e a trava de envio único.
 *
 * Em 26/08/2026 a confirmação saía no NASCIMENTO do job. Um cliente com o job
 * ainda `unassigned` recebeu o `booking_confirmed` e respondeu "Hi, I would like
 * to cancel this order." Job sem parceiro é job que ainda estamos tentando
 * colocar: confirmar ali promete uma visita que talvez não exista.
 *
 * Em 14/10/2026: 0 de 47 jobs confirmados. A trava geral voltava sem gravar
 * motivo, e a confirmação passou a ser reavaliada na atribuição e numa
 * varredura de recuperação. Daí os testes da trava atômica e do portão de
 * status/data.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { enviarConfirmacaoDoCliente, motivoParaNaoConfirmar, MOTIVO_MENSAGENS_DESLIGADAS, MOTIVO_SO_POR_EMAIL } from "./send";
import { fakeSupabase } from "./fake-supabase.test-helper";

type Job = Record<string, unknown>;

const AGORA = new Date("2026-10-14T11:00:00Z");
const motivoDe = (r: { estado: string } & { motivo?: string }) => r.motivo ?? "";

const JOB_BASE: Job = {
  id: "job-1",
  reference: "JOB-9999",
  title: "General Maintenance",
  status: "unassigned",
  partner_id: null,
  scheduled_date: "2026-10-16",
  scheduled_start_at: "2026-10-16T08:00:00Z",
  scheduled_end_at: "2026-10-16T11:00:00Z",
  client_id: "cli-1",
  client_name: "Zabel Smith",
  client_confirmation_sent_at: null,
  client_confirmation_skipped: null,
  client_reminder_sent_at: null,
};

const COM_PARCEIRO: Job = { ...JOB_BASE, partner_id: "p-1", status: "scheduled" };

function banco(job: Job, conta: Record<string, unknown> = { id: "acc-fixfy", company_name: "Fixfy", client_confirmation_whatsapp: true }) {
  return fakeSupabase({
    jobs: [{ ...job }],
    clients: [{ id: "cli-1", full_name: "Zabel Smith", phone: "07508 801803", source_account_id: conta.id }],
    accounts: [{ ...conta }],
  });
}

const ENV = ["CLIENT_MESSAGING_ENABLED", "SUNSHINE_APP_ID", "SUNSHINE_KEY_ID", "SUNSHINE_KEY_SECRET", "FIXFY_AGENT_MODEL", "CONFIRMACAO_WHATSAPP", "CLIENT_WA_VIA"];
let salvo: Record<string, string | undefined> = {};

describe("confirmação ao cliente", () => {
  beforeEach(() => {
    salvo = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    process.env.CLIENT_MESSAGING_ENABLED = "1";
    process.env.CONFIRMACAO_WHATSAPP = "on";
    process.env.SUNSHINE_APP_ID = "app";
    process.env.SUNSHINE_KEY_ID = "key";
    process.env.SUNSHINE_KEY_SECRET = "secret";
    delete process.env.FIXFY_AGENT_MODEL;
    delete process.env.CLIENT_WA_VIA;
  });
  afterEach(() => {
    for (const k of ENV) {
      if (salvo[k] === undefined) delete process.env[k];
      else process.env[k] = salvo[k];
    }
  });

  test("job unassigned não fala com o cliente, e o motivo fica no job", async () => {
    const { client, tabelas } = banco(JOB_BASE);
    const r = await enviarConfirmacaoDoCliente(client, "job-1", { agora: AGORA });
    assert.equal(r.estado, "pulado");
    assert.match(motivoDe(r), /no partner assigned/);
    assert.match(String(tabelas.jobs[0].client_confirmation_skipped), /no partner assigned/);
  });

  test("o portão do parceiro vem ANTES de procurar o cliente", async () => {
    const { client } = banco({ ...JOB_BASE, client_id: null });
    const r = await enviarConfirmacaoDoCliente(client, "job-1", { agora: AGORA });
    assert.match(motivoDe(r), /no partner assigned/);
  });

  test("trava geral desligada AGORA grava o motivo no job (antes voltava calada)", async () => {
    delete process.env.CLIENT_MESSAGING_ENABLED;
    let chamou = false;
    const { client, tabelas } = banco(COM_PARCEIRO);
    const r = await enviarConfirmacaoDoCliente(client, "job-1", { agora: AGORA, enviar: async () => { chamou = true; return { messageId: "x", to: "" }; } });
    assert.equal(r.estado, "pulado");
    assert.equal(motivoDe(r), MOTIVO_MENSAGENS_DESLIGADAS);
    assert.equal(tabelas.jobs[0].client_confirmation_skipped, MOTIVO_MENSAGENS_DESLIGADAS);
    assert.equal(chamou, false);
  });

  test("sem CONFIRMACAO_WHATSAPP a confirmação fica só no e-mail do ticket (dono, 14/10/2026)", async () => {
    delete process.env.CONFIRMACAO_WHATSAPP;
    let chamou = false;
    const { client, tabelas } = banco(COM_PARCEIRO);
    const r = await enviarConfirmacaoDoCliente(client, "job-1", { agora: AGORA, enviar: async () => { chamou = true; return { messageId: "x", to: "" }; } });
    assert.equal(r.estado, "pulado");
    assert.equal(motivoDe(r), MOTIVO_SO_POR_EMAIL);
    assert.equal(tabelas.jobs[0].client_confirmation_skipped, MOTIVO_SO_POR_EMAIL);
    assert.equal(chamou, false);
  });

  test("o 'no partner assigned yet' do nascimento não trava o envio quando o parceiro entra", async () => {
    const enviados: unknown[] = [];
    const { client, tabelas } = banco({
      ...COM_PARCEIRO,
      client_confirmation_skipped: "no partner assigned yet: nothing to confirm to the client",
    });
    const r = await enviarConfirmacaoDoCliente(client, "job-1", {
      agora: AGORA,
      enviar: async (m) => { enviados.push(m); return { messageId: "wamid.1", to: m.to }; },
    });
    assert.equal(r.estado, "enviado");
    assert.equal(enviados.length, 1);
    assert.deepEqual((enviados[0] as { bodyParams: string[] }).bodyParams, [
      "Zabel", "Friday 16 October", "09:00 to 12:00", "General Maintenance",
    ]);
    assert.ok(tabelas.jobs[0].client_confirmation_sent_at);
    assert.equal(tabelas.jobs[0].client_confirmation_skipped, null);
  });

  test("duas chamadas juntas (aceite + rota de atribuição) mandam UMA mensagem", async () => {
    let n = 0;
    const enviar = async (m: { to: string }) => { n++; return { messageId: `w${n}`, to: m.to }; };
    const { client } = banco(COM_PARCEIRO);
    const [a, b] = await Promise.all([
      enviarConfirmacaoDoCliente(client, "job-1", { agora: AGORA, enviar }),
      enviarConfirmacaoDoCliente(client, "job-1", { agora: AGORA, enviar }),
    ]);
    assert.equal(n, 1);
    assert.deepEqual([a.estado, b.estado].sort(), ["enviado", "pulado"]);
  });

  test("já enviado não manda de novo", async () => {
    let n = 0;
    const { client } = banco({ ...COM_PARCEIRO, client_confirmation_sent_at: "2026-10-13T10:00:00Z" });
    const r = await enviarConfirmacaoDoCliente(client, "job-1", { agora: AGORA, enviar: async (m) => { n++; return { messageId: "x", to: m.to }; } });
    assert.equal(r.estado, "pulado");
    assert.equal(n, 0);
  });

  test("falha no envio devolve a trava para a próxima tentativa", async () => {
    const { client, tabelas } = banco(COM_PARCEIRO);
    const r = await enviarConfirmacaoDoCliente(client, "job-1", {
      agora: AGORA,
      enviar: async () => { throw new Error("Sunshine 400: bad number"); },
    });
    assert.equal(r.estado, "falhou");
    assert.equal(tabelas.jobs[0].client_confirmation_sent_at, null);
    assert.match(String(tabelas.jobs[0].client_confirmation_skipped), /bad number/);
  });

  test("conta que não manda (Li & Fung) continua sem mensagem", async () => {
    let n = 0;
    const { client } = banco(COM_PARCEIRO, { id: "acc-lf", company_name: "Li & Fung", client_confirmation_whatsapp: false });
    const r = await enviarConfirmacaoDoCliente(client, "job-1", { agora: AGORA, enviar: async (m) => { n++; return { messageId: "x", to: m.to }; } });
    assert.match(motivoDe(r), /Li & Fung does not send/);
    assert.equal(n, 0);
  });

  test("lembrete de véspera já saiu: uma mensagem basta", async () => {
    let n = 0;
    const { client } = banco({ ...COM_PARCEIRO, client_reminder_sent_at: "2026-10-15T17:00:00Z" });
    const r = await enviarConfirmacaoDoCliente(client, "job-1", { agora: AGORA, enviar: async (m) => { n++; return { messageId: "x", to: m.to }; } });
    assert.match(motivoDe(r), /reminder already went out/);
    assert.equal(n, 0);
  });

  test("ensaio não grava nada no banco", async () => {
    const { client, escritas } = banco({ ...COM_PARCEIRO, partner_id: null });
    await enviarConfirmacaoDoCliente(client, "job-1", { agora: AGORA, simular: true });
    const { client: c2, escritas: e2 } = banco(COM_PARCEIRO);
    const r = await enviarConfirmacaoDoCliente(c2, "job-1", { agora: AGORA, simular: true });
    assert.match(motivoDe(r), /^dry run: would send/);
    assert.equal(escritas.length + e2.length, 0);
  });
});

describe("motivoParaNaoConfirmar", () => {
  test("agendado no futuro pede confirmação", () => {
    assert.equal(motivoParaNaoConfirmar({ status: "scheduled", scheduled_date: "2026-10-16" }, AGORA), null);
  });
  test("hoje ainda vale (atribuição da manhã para a tarde)", () => {
    assert.equal(motivoParaNaoConfirmar({ status: "scheduled", scheduled_date: "2026-10-14" }, AGORA), null);
  });
  test("data no passado não confirma", () => {
    assert.match(String(motivoParaNaoConfirmar({ status: "scheduled", scheduled_date: "2026-10-13" }, AGORA)), /passed/);
  });
  test("cancelado, concluído ou em andamento não confirma", () => {
    for (const s of ["cancelled", "completed", "in_progress", "awaiting_payment"]) {
      assert.match(String(motivoParaNaoConfirmar({ status: s, scheduled_date: "2026-10-16" }, AGORA)), new RegExp(s));
    }
  });
  test("o dia é o de Londres: 23h30 UTC de 14/10 já é 15/10 no BST", () => {
    assert.match(
      String(motivoParaNaoConfirmar({ status: "scheduled", scheduled_date: "2026-10-14" }, new Date("2026-10-14T23:30:00Z"))),
      /passed/,
    );
  });
});
