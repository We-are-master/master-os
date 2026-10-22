/**
 * Cartão recusado: e-mails no dia 1, 3 e 7, parada no pagamento, e no dia 7 a
 * pendência Payment Unsuccessful com fim das tentativas automáticas.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chaveDaCobranca, decidirCobranca, diaDaCobranca, emailDaCobranca, primeiraRecusaDesde, varrerCartaoRecusado } from "./cartao-recusado";
import { fakeSupabase } from "@/lib/client-confirmation/fake-supabase.test-helper";
import type { RegrasDoProcesso } from "@/lib/processo/conta";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Tabela que só responde vazio e guarda o que foi pedido (upsert/insert que o fake não tem). */
function tabelaMuda(chamadas: Array<{ op: string; arg: unknown }>) {
  const b: Record<string, unknown> = {};
  for (const op of ["select", "eq", "is", "in", "update", "upsert", "insert", "order", "limit"]) {
    b[op] = (arg: unknown) => { chamadas.push({ op, arg }); return b; };
  }
  b.maybeSingle = async () => ({ data: null, error: null });
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
  return b;
}
function comTabelasMudas(client: SupabaseClient, nomes: string[], chamadas: Array<{ op: string; arg: unknown }>): SupabaseClient {
  return { from: (t: string) => (nomes.includes(t) ? tabelaMuda(chamadas) : client.from(t)) } as unknown as SupabaseClient;
}

const v2Direct: Pick<RegrasDoProcesso, "v2" | "tipo" | "cobraDoCliente"> = { v2: true, tipo: "direct", cobraDoCliente: true };
const recusado = { status: "awaiting_payment", card_charge_status: "refused", finance_status: "unpaid" };

describe("régua de cobrança", () => {
  test("dia 0 espera; 1 e 2 → e-mail do dia 1; 3 a 6 → dia 3; 7 em diante → dia 7", () => {
    assert.equal(diaDaCobranca(0), null);
    assert.equal(diaDaCobranca(null), null);
    assert.equal(diaDaCobranca(1), 1);
    assert.equal(diaDaCobranca(2), 1);
    assert.equal(diaDaCobranca(3), 3);
    assert.equal(diaDaCobranca(6), 3);
    assert.equal(diaDaCobranca(7), 7);
    assert.equal(diaDaCobranca(30), 7);
  });

  test("a chave é uma por job e dia", () => {
    assert.equal(chaveDaCobranca("j1", 3), "cobranca-cartao:j1:3");
  });

  test("a 1ª recusa conta depois da última cobrança que passou", () => {
    assert.equal(
      primeiraRecusaDesde([
        { status: "failed", created_at: "2026-10-01T10:00:00Z" },
        { status: "succeeded", created_at: "2026-10-02T10:00:00Z" },
        { status: "failed", created_at: "2026-10-10T10:00:00Z" },
        { status: "failed", created_at: "2026-10-11T10:00:00Z" },
      ]),
      "2026-10-10T10:00:00Z",
    );
    assert.equal(primeiraRecusaDesde([]), null);
  });

  test("decisão: cobrar no dia, pessoa só a partir do dia 7", () => {
    assert.deepEqual(decidirCobranca(recusado, v2Direct, 3), { acao: "cobrar", dia: 3, precisaDePessoa: false });
    assert.deepEqual(decidirCobranca(recusado, v2Direct, 8), { acao: "cobrar", dia: 7, precisaDePessoa: true });
    assert.equal(decidirCobranca(recusado, v2Direct, 0).acao, "esperar");
  });

  test("pago para na hora, mesmo com o cartão ainda marcado como recusado", () => {
    assert.equal(decidirCobranca({ ...recusado, finance_status: "paid" }, v2Direct, 3).acao, "pago");
  });

  test("fora do fluxo novo: conta sem v2, plataforma, job fora de Awaiting Payment", () => {
    assert.equal(decidirCobranca(recusado, { ...v2Direct, v2: false }, 3).acao, "fora");
    assert.equal(decidirCobranca(recusado, { v2: true, tipo: "platform", cobraDoCliente: false }, 3).acao, "fora");
    assert.equal(decidirCobranca({ ...recusado, status: "final_check" }, v2Direct, 3).acao, "fora");
    assert.equal(decidirCobranca({ ...recusado, card_charge_status: "charged" }, v2Direct, 3).acao, "fora");
  });

  test("texto: inglês, link de pagamento, sem travessão e sem VAT", () => {
    for (const dia of [1, 3, 7] as const) {
      const e = emailDaCobranca(dia, { primeiroNome: "Ana", referencia: "JOB-1", servico: "Deep Clean", link: "https://app.getfixfy.com/pay/INV-1" });
      assert.match(e.html, /\/pay\/INV-1/);
      assert.doesNotMatch(e.html + e.assunto, /—|VAT/);
    }
  });
});

describe("varrerCartaoRecusado", () => {
  const AGORA = new Date("2026-10-22T09:00:00Z");
  const FIXFY = "5cf896ec-ee42-441b-a698-34fdaeeb28b3";
  let salvo: Record<string, string | undefined> = {};
  const ENV = ["PROCESSOS_V2", "CLIENT_MESSAGING_ENABLED"];
  beforeEach(() => {
    salvo = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    process.env.PROCESSOS_V2 = "on";
  });
  afterEach(() => {
    for (const k of ENV) { if (salvo[k] === undefined) delete process.env[k]; else process.env[k] = salvo[k]; }
  });

  function banco(diasAtras: number, extra: Record<string, unknown> = {}) {
    const desde = new Date(AGORA.getTime() - diasAtras * 86_400_000 - 3_600_000).toISOString();
    return fakeSupabase({
      accounts: [{ id: FIXFY, process_type: "direct", process_rules: { v2: true } }],
      jobs: [{
        id: "j1", reference: "JOB-1", title: "Deep Clean", status: "awaiting_payment", account_id: FIXFY, client_id: "c1", client_name: "Ana Silva",
        invoice_id: "i1", external_source: "zendesk", external_ref: "123", card_charge_status: "refused", card_retry_at: "2026-10-23T09:00:00Z",
        finance_status: "unpaid", client_price: 200, deleted_at: null, ...extra,
      }],
      clients: [{ id: "c1", full_name: "Ana Silva", email: "ana@example.com", source_account_id: FIXFY }],
      invoices: [{ id: "i1", reference: "INV-2026-1" }],
      stripe_charge_attempts: [{ job_id: "j1", status: "failed", created_at: desde }],
      job_attention_reasons: [],
    });
  }

  test("sem PROCESSOS_V2 nada acontece", async () => {
    delete process.env.PROCESSOS_V2;
    const { client, escritas } = banco(3);
    const r = await varrerCartaoRecusado(client, { aplicar: true, agora: AGORA });
    assert.equal(r.linhas.length, 0);
    assert.equal(escritas.length, 0);
  });

  test("ensaio no dia 3: lista o e-mail do dia 3 com o link /pay da fatura, não grava", async () => {
    const { client, escritas } = banco(3);
    const r = await varrerCartaoRecusado(client, { agora: AGORA });
    assert.equal(r.linhas[0].resultado, "enviaria");
    assert.match(r.linhas[0].detalhe, /day 3 · ana@example.com · .*\/pay\/INV-2026-1/);
    assert.equal(escritas.length, 0);
  });

  test("pago: para, nenhum e-mail", async () => {
    const { client } = banco(3, { finance_status: "paid" });
    let avisos = 0;
    const r = await varrerCartaoRecusado(client, { aplicar: true, agora: AGORA, avisar: async () => { avisos++; } });
    assert.equal(r.linhas[0].resultado, "parado");
    assert.equal(avisos, 0);
  });

  test("dia 7 com aplicar: card_retry_at vira null (acabam as tentativas automáticas)", async () => {
    delete process.env.CLIENT_MESSAGING_ENABLED; // e-mail não sai; o passo interno sai
    const { client, tabelas } = banco(8);
    const chamadas: Array<{ op: string; arg: unknown }> = [];
    const sb = comTabelasMudas(client, ["job_attention_reasons", "outbound_messages"], chamadas);
    const r = await varrerCartaoRecusado(sb, { aplicar: true, agora: AGORA, nota: async () => undefined });
    assert.equal((tabelas.jobs[0] as Record<string, unknown>).card_retry_at, null);
    // Abre Payment Unsuccessful nas pendências.
    const upsert = chamadas.find((c) => c.op === "upsert")?.arg as Array<{ reason: string }>;
    assert.ok(upsert.some((m) => m.reason === "payment_unsuccessful"));
    assert.equal(r.linhas[0].resultado, "enviaria");
    assert.match(r.linhas[0].detalhe, /day 7/);
  });
});
