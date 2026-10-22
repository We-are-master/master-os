/**
 * Lembrete de véspera pelo canal ativo (contas v2) e uma chave por job e horário.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canalDoLembrete, chaveDoLembrete, emailDoLembrete } from "./lembrete-canal";
import { fakeSupabase } from "./fake-supabase.test-helper";

describe("canalDoLembrete", () => {
  test("conversa por e-mail vai por e-mail, mesmo com mobile", () => {
    assert.equal(canalDoLembrete({ conversationChannel: "email", telefone: "07508801803" }), "email");
  });
  test("sem mobile UK vai por e-mail", () => {
    assert.equal(canalDoLembrete({ conversationChannel: "whatsapp", telefone: null }), "email");
    assert.equal(canalDoLembrete({ conversationChannel: null, telefone: "020 4538 4668" }), "email");
  });
  test("conta só de e-mail vai por e-mail", () => {
    assert.equal(canalDoLembrete({ conversationChannel: "whatsapp", telefone: "07508801803", canaisDaConta: ["email"] }), "email");
  });
  test("WhatsApp com mobile continua WhatsApp", () => {
    assert.equal(canalDoLembrete({ conversationChannel: "whatsapp", telefone: "07508801803", canaisDaConta: ["email", "whatsapp"] }), "whatsapp");
    assert.equal(canalDoLembrete({ conversationChannel: null, telefone: "+44 7508 801803" }), "whatsapp");
  });
});

describe("chaveDoLembrete", () => {
  test("mesmo horário, mesma chave; outro horário, chave nova", () => {
    assert.equal(chaveDoLembrete("j1", "2026-10-23T08:00:00Z"), "lembrete-24h:j1:2026-10-23T08:00:00Z");
    assert.notEqual(chaveDoLembrete("j1", "2026-10-23T08:00:00Z"), chaveDoLembrete("j1", "2026-10-23T12:00:00Z"));
    assert.equal(chaveDoLembrete("j1", null, "2026-10-23"), "lembrete-24h:j1:2026-10-23");
  });
  test("texto do e-mail: inglês, sem travessão, sem VAT", () => {
    const e = emailDoLembrete({ primeiroNome: "Ana", data: "Friday 23 October", janela: "08:00 to 10:00", endereco: "1 High St, W1" });
    assert.match(e.html, /tomorrow, Friday 23 October/);
    assert.doesNotMatch(e.html + e.assunto, /—|VAT/);
  });
});

/** outbound_messages em memória com a chave única, como no banco (23505). */
function outboxEmMemoria() {
  const linhas: Array<Record<string, unknown>> = [];
  const tabela = () => {
    const filtros: Array<[string, unknown]> = [];
    let patch: Record<string, unknown> | null = null;
    const alvo = () => linhas.filter((l) => filtros.every(([c, v]) => l[c] === v));
    const b: Record<string, unknown> = {
      insert: async (l: Record<string, unknown>) => {
        if (linhas.some((x) => x.dedupe_key === l.dedupe_key)) return { error: { code: "23505", message: "duplicate" } };
        linhas.push({ ...l });
        return { error: null };
      },
      update: (p: Record<string, unknown>) => { patch = p; return b; },
      select: () => b,
      eq: (c: string, v: unknown) => { filtros.push([c, v]); return b; },
      maybeSingle: async () => ({ data: alvo()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown) => {
        const a = alvo();
        if (patch) for (const l of a) Object.assign(l, patch);
        return Promise.resolve({ data: a.map((l) => ({ dedupe_key: l.dedupe_key })), error: null }).then(ok);
      },
    };
    return b;
  };
  return { linhas, tabela };
}

describe("varrerLembretesDeVespera, conta v2 com canal e-mail", () => {
  const FIXFY = "5cf896ec-ee42-441b-a698-34fdaeeb28b3";
  const AGORA = new Date("2026-10-22T10:00:00Z"); // 11h em Londres; amanhã = 23/10
  const ENV = ["PROCESSOS_V2", "CLIENT_MESSAGING_ENABLED", "ZENDESK_SUBDOMAIN", "ZENDESK_EMAIL", "ZENDESK_API_TOKEN"];
  let salvo: Record<string, string | undefined> = {};
  beforeEach(() => {
    salvo = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    process.env.PROCESSOS_V2 = "on";
    process.env.CLIENT_MESSAGING_ENABLED = "1";
    // O módulo do Zendesk lê as credenciais no import: entram antes do import dinâmico abaixo.
    process.env.ZENDESK_SUBDOMAIN = "x"; process.env.ZENDESK_EMAIL = "x@y.z"; process.env.ZENDESK_API_TOKEN = "t";
  });
  afterEach(() => {
    for (const k of ENV) { if (salvo[k] === undefined) delete process.env[k]; else process.env[k] = salvo[k]; }
  });

  test("manda por e-mail no ticket; remarcar de volta ao mesmo horário não repete; outro horário manda de novo", async () => {
    const { varrerLembretesDeVespera } = await import("./sweep-24h");
    const fake = fakeSupabase({
      jobs: [{
        id: "j1", reference: "JOB-1", status: "scheduled", title: "Clean", scheduled_date: "2026-10-23",
        scheduled_start_at: "2026-10-23T07:00:00Z", scheduled_end_at: "2026-10-23T09:00:00Z",
        partner_id: "p1", client_id: "c1", client_name: "Ana Silva", property_address: "1 High St, W1",
        client_reminder_sent_at: null, client_confirmation_sent_at: null, external_source: "zendesk", external_ref: "555",
        account_id: FIXFY, conversation_channel: "email",
      }],
      clients: [{ id: "c1", full_name: "Ana Silva", phone: "07508801803", email: "ana@example.com", source_account_id: FIXFY }],
      accounts: [{ id: FIXFY, process_type: "direct", process_rules: { v2: true }, company_name: "Fixfy", client_confirmation_whatsapp: true }],
    });
    const outbox = outboxEmMemoria();
    const sb = { from: (t: string) => (t === "outbound_messages" ? outbox.tabela() : fake.client.from(t)) } as unknown as SupabaseClient;
    const enviados: Array<{ ticketId: number; email: string | null }> = [];
    let whatsapps = 0;
    const opcoes = {
      agora: AGORA, enviarDeVerdade: true,
      avisarPorEmail: async (a: { ticketId: number; para: { email: string | null } }) => { enviados.push({ ticketId: a.ticketId, email: a.para.email }); },
      enviar: (async () => { whatsapps++; return { messageId: "x" }; }) as never,
    };

    const r1 = await varrerLembretesDeVespera(sb, opcoes);
    assert.equal(r1.linhas[0].resultado, "enviado");
    assert.deepEqual(enviados, [{ ticketId: 555, email: "ana@example.com" }]);
    assert.equal(whatsapps, 0);
    assert.equal(outbox.linhas[0].dedupe_key, "lembrete-24h:j1:2026-10-23T07:00:00Z");
    assert.equal(outbox.linhas[0].status, "sent");

    // Remarcou para outro horário e voltou ao mesmo: a remarcação zera o carimbo.
    const job = fake.tabelas.jobs[0] as Record<string, unknown>;
    job.client_reminder_sent_at = null;
    const r2 = await varrerLembretesDeVespera(sb, opcoes);
    assert.equal(r2.linhas[0].resultado, "pulado");
    assert.match(r2.linhas[0].detalhe, /already handled/);
    assert.equal(enviados.length, 1);

    // Outro horário de verdade: lembrete novo.
    job.client_reminder_sent_at = null;
    job.scheduled_start_at = "2026-10-23T11:00:00Z";
    job.scheduled_end_at = "2026-10-23T13:00:00Z";
    const r3 = await varrerLembretesDeVespera(sb, opcoes);
    assert.equal(r3.linhas[0].resultado, "enviado");
    assert.equal(enviados.length, 2);
  });
});

describe("varrerLembretesDeVespera, visita extra de amanhã (22/10/2026)", () => {
  const FIXFY = "5cf896ec-ee42-441b-a698-34fdaeeb28b3";
  const AGORA = new Date("2026-10-22T10:00:00Z"); // amanhã = 23/10
  const ENV = ["PROCESSOS_V2", "CLIENT_MESSAGING_ENABLED", "ZENDESK_SUBDOMAIN", "ZENDESK_EMAIL", "ZENDESK_API_TOKEN"];
  let salvo: Record<string, string | undefined> = {};
  beforeEach(() => {
    salvo = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    process.env.PROCESSOS_V2 = "on";
    process.env.CLIENT_MESSAGING_ENABLED = "1";
    process.env.ZENDESK_SUBDOMAIN = "x"; process.env.ZENDESK_EMAIL = "x@y.z"; process.env.ZENDESK_API_TOKEN = "t";
  });
  afterEach(() => {
    for (const k of ENV) { if (salvo[k] === undefined) delete process.env[k]; else process.env[k] = salvo[k]; }
  });

  // JOB-9705: o job está em Final review dia 20; a V3 é amanhã às 8h com outro parceiro.
  const pai = {
    id: "j9705", reference: "JOB-9705", status: "final_check", title: "Maintenance", scheduled_date: "2026-10-20",
    scheduled_start_at: "2026-10-20T07:00:00Z", scheduled_end_at: "2026-10-20T08:00:00Z",
    partner_id: "p1", client_id: "c1", client_name: "Kate Allen", property_address: "13 Herne Hill, SE24",
    client_reminder_sent_at: "2026-10-19T10:00:00Z", client_confirmation_sent_at: null, external_source: "zendesk", external_ref: "777",
    account_id: FIXFY, conversation_channel: "email", deleted_at: null,
  };
  const montar = (visita: Record<string, unknown>) => {
    const fake = fakeSupabase({
      jobs: [pai],
      job_visits: [{
        id: "v3", job_id: "j9705", visit_index: 3, status: "scheduled", scheduled_date: "2026-10-23",
        scheduled_start_at: "2026-10-23T07:00:00Z", scheduled_end_at: "2026-10-23T08:00:00Z",
        partner_id: "p-tm", partner_name: "TM Handyman", client_confirmation_sent_at: null, deleted_at: null,
        parent: pai, ...visita,
      }],
      clients: [{ id: "c1", full_name: "Kate Allen", phone: "07508801803", email: "kate@example.com", source_account_id: FIXFY }],
      accounts: [{ id: FIXFY, process_type: "direct", process_rules: { v2: true }, company_name: "Fixfy", client_confirmation_whatsapp: true }],
    });
    const outbox = outboxEmMemoria();
    const sb = { from: (t: string) => (t === "outbound_messages" ? outbox.tabela() : fake.client.from(t)) } as unknown as SupabaseClient;
    return { fake, outbox, sb };
  };

  test("a V3 recebe o lembrete pela data dela, e o carimbo vai na visita, não no job", async () => {
    const { varrerLembretesDeVespera } = await import("./sweep-24h");
    const { fake, outbox, sb } = montar({});
    const enviados: number[] = [];
    const r = await varrerLembretesDeVespera(sb, {
      agora: AGORA, enviarDeVerdade: true,
      avisarPorEmail: async (a: { ticketId: number }) => { enviados.push(a.ticketId); },
      enviar: (async () => ({ messageId: "x" })) as never,
    });
    assert.equal(r.linhas.length, 1);
    assert.equal(r.linhas[0].reference, "JOB-9705 · V3");
    assert.equal(r.linhas[0].resultado, "enviado");
    assert.deepEqual(enviados, [777]);
    assert.equal(outbox.linhas[0].dedupe_key, "lembrete-24h:j9705:2026-10-23T07:00:00Z");
    assert.ok((fake.tabelas.job_visits[0] as Record<string, unknown>).client_confirmation_sent_at);
    assert.equal((fake.tabelas.jobs[0] as Record<string, unknown>).client_reminder_sent_at, "2026-10-19T10:00:00Z");

    // Segunda rodada: a visita já está carimbada, nada sai de novo.
    const r2 = await varrerLembretesDeVespera(sb, { agora: AGORA, enviarDeVerdade: true, avisarPorEmail: async () => { enviados.push(0); } });
    assert.equal(r2.linhas[0].resultado, "pulado");
    assert.equal(enviados.length, 1);
  });

  test("visita marcada pelo escritório (client_confirmation_sent_at) não recebe lembrete", async () => {
    const { varrerLembretesDeVespera } = await import("./sweep-24h");
    const { sb } = montar({ client_confirmation_sent_at: "2026-10-21T09:00:00Z" });
    let chamadas = 0;
    const r = await varrerLembretesDeVespera(sb, {
      agora: AGORA, enviarDeVerdade: true,
      avisarPorEmail: async () => { chamadas++; },
      enviar: (async () => { chamadas++; return { messageId: "x" }; }) as never,
    });
    assert.equal(chamadas, 0);
    assert.equal(r.linhas[0].resultado, "pulado");
    assert.match(r.linhas[0].detalhe, /already marked as client notified/);
  });

  test("visita no mesmo horário de um job agendado não vira segundo lembrete", async () => {
    const { visitasComoLembretes } = await import("./sweep-24h");
    const agendado = { ...pai, status: "scheduled", scheduled_date: "2026-10-23", scheduled_start_at: "2026-10-23T07:00:00Z" };
    const { lembretes } = visitasComoLembretes([{
      id: "v2", job_id: "j9705", visit_index: 2, status: "scheduled", scheduled_date: "2026-10-23",
      scheduled_start_at: "2026-10-23T07:00:00Z", client_price: 0, partner_cost: 0, materials_cost: 0,
      created_at: "", updated_at: "", parent: agendado,
    } as never], "2026-10-23");
    assert.equal(lembretes.length, 0);
  });
});
