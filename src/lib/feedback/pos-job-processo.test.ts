/**
 * Feedback pelo processo da conta (regras.v2, plano de 22/10/2026): Fixfy pede no
 * dia seguinte à conclusão mesmo com saldo pendente; plataforma (Express) só depois
 * de pago; B2B nunca. Conta sem v2 segue a regra de 14/10/2026.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { feedbackPeloProcesso, varrerFeedbackPosJob } from "./pos-job";
import { fakeSupabase } from "@/lib/client-confirmation/fake-supabase.test-helper";

const HOJE = "2026-10-14";

describe("feedbackPeloProcesso (puro)", () => {
  const base = { conclusaoYmd: "2026-10-13", hojeYmd: HOJE, maxDias: 7 };

  test("Fixfy com saldo pendente (Awaiting Payment): pede no dia seguinte à conclusão", () => {
    const r = feedbackPeloProcesso({ ...base, status: "awaiting_payment", financeStatus: "partial", regra: "depois_da_conclusao" });
    assert.equal(r.elegivel, true);
    assert.equal(r.ancora, "2026-10-13");
  });

  test("concluído hoje ainda não", () => {
    assert.equal(feedbackPeloProcesso({ ...base, conclusaoYmd: HOJE, status: "completed", financeStatus: "paid", regra: "depois_da_conclusao" }).elegivel, false);
  });

  test("Express: não pede antes de a plataforma pagar", () => {
    const r = feedbackPeloProcesso({ ...base, status: "completed", financeStatus: "unpaid", regra: "depois_do_pagamento_da_plataforma" });
    assert.equal(r.elegivel, false);
    assert.match(r.motivo, /platform to pay/);
  });

  test("Express pago: conta do dia do pagamento, não da conclusão", () => {
    const pagoOntem = feedbackPeloProcesso({ ...base, conclusaoYmd: "2026-09-01", pagoYmd: "2026-10-13", status: "completed", financeStatus: "paid", regra: "depois_do_pagamento_da_plataforma" });
    assert.deepEqual([pagoOntem.elegivel, pagoOntem.ancora], [true, "2026-10-13"]);
    const pagoHoje = feedbackPeloProcesso({ ...base, pagoYmd: HOJE, status: "completed", financeStatus: "paid", regra: "depois_do_pagamento_da_plataforma" });
    assert.equal(pagoHoje.elegivel, false);
  });

  test("Express pago sem data de pagamento: usa a conclusão", () => {
    const r = feedbackPeloProcesso({ ...base, pagoYmd: null, status: "completed", financeStatus: "paid", regra: "depois_do_pagamento_da_plataforma" });
    assert.deepEqual([r.elegivel, r.ancora], [true, "2026-10-13"]);
  });

  test("B2B nunca", () => {
    assert.equal(feedbackPeloProcesso({ ...base, status: "completed", financeStatus: "paid", regra: "nunca" }).elegivel, false);
  });

  test("job que não terminou nunca entra", () => {
    assert.equal(feedbackPeloProcesso({ ...base, status: "final_check", financeStatus: "unpaid", regra: "depois_da_conclusao" }).elegivel, false);
  });
});

describe("varrerFeedbackPosJob com PROCESSOS_V2", () => {
  const AGORA = new Date("2026-10-14T10:00:00Z");
  const FIXFY = "5cf896ec-ee42-441b-a698-34fdaeeb28b3";
  const EXPRESS = "38b48520-f116-4263-90e5-8cd5a7d39ecf";
  const ENV = ["PROCESSOS_V2", "FIXFY_ACCOUNT_ID", "FEEDBACK_JANELA_DIAS"];
  let salvo: Record<string, string | undefined> = {};
  beforeEach(() => {
    salvo = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    process.env.PROCESSOS_V2 = "on";
    process.env.FIXFY_ACCOUNT_ID = FIXFY;
    delete process.env.FEEDBACK_JANELA_DIAS;
  });
  afterEach(() => {
    for (const k of ENV) { if (salvo[k] === undefined) delete process.env[k]; else process.env[k] = salvo[k]; }
  });

  function job(id: string, extra: Record<string, unknown>) {
    return {
      id, reference: `JOB-${id}`, title: "Clean", status: "completed", client_id: `cli-${id}`, client_name: "X",
      external_source: null, external_ref: null, internal_notes: null,
      scheduled_date: "2026-10-12", scheduled_start_at: "2026-10-12T08:00:00Z", completed_date: null,
      partner_timer_ended_at: null, final_report: { submitted_at: "2026-10-13T15:00:00Z" },
      on_hold_reason_preset_id: null, on_hold_reason: null, on_hold_complaint_description: null,
      customer_review_submitted_at: null, feedback_requested_at: null, deleted_at: null,
      account_id: null, finance_status: "unpaid", payment_status: null, invoice_id: null, ...extra,
    };
  }
  const cliente = (id: string, conta: string | null) => ({ id: `cli-${id}`, full_name: `Cliente ${id}`, phone: "07508801803", source_account_id: conta });

  function banco() {
    return fakeSupabase({
      jobs: [
        job("F1", { account_id: FIXFY, status: "awaiting_payment", finance_status: "partial" }), // saldo pendente: pede
        job("E1", { account_id: EXPRESS, finance_status: "unpaid" }), // Express sem pagar: espera
        job("E2", { account_id: EXPRESS, finance_status: "paid", invoice_id: "inv-2" }), // pago ontem: pede
        job("E3", { account_id: EXPRESS, finance_status: "paid", invoice_id: "inv-3" }), // pago hoje: amanhã
        job("B1", { account_id: "acc-b2b", finance_status: "paid" }), // B2B: nunca
        job("N1", { status: "awaiting_payment" }), // sem conta v2: a regra de antes (só concluído)
      ],
      clients: [cliente("F1", FIXFY), cliente("E1", EXPRESS), cliente("E2", EXPRESS), cliente("E3", EXPRESS), cliente("B1", "acc-b2b"), cliente("N1", null)],
      accounts: [
        { id: FIXFY, process_type: "direct", process_rules: { v2: true } },
        { id: EXPRESS, process_type: "platform", process_rules: { v2: true } },
        { id: "acc-b2b", process_type: "b2b", process_rules: { v2: true }, company_name: "Li & Fung", client_feedback_whatsapp: true },
      ],
      invoices: [
        { id: "inv-2", paid_date: "2026-10-13", last_payment_date: "2026-10-13" },
        { id: "inv-3", paid_date: "2026-10-14", last_payment_date: "2026-10-14" },
      ],
      partner_feedback: [],
    });
  }

  test("cada processo na sua regra", async () => {
    const { client, escritas } = banco();
    const r = await varrerFeedbackPosJob(client, { agora: AGORA, lerZendesk: async () => null });
    const por = Object.fromEntries(r.linhas.map((l) => [l.reference, l]));
    assert.equal(por["JOB-F1"].resultado, "enviaria");
    assert.equal(por["JOB-E1"].resultado, "pulado");
    assert.match(por["JOB-E1"].detalhe, /platform to pay/);
    assert.equal(por["JOB-E2"].resultado, "enviaria");
    assert.match(por["JOB-E2"].detalhe, /^2026-10-13/);
    assert.equal(por["JOB-E3"], undefined);
    assert.equal(por["JOB-B1"].resultado, "pulado");
    assert.match(por["JOB-B1"].detalhe, /never/);
    assert.equal(por["JOB-N1"], undefined);
    assert.equal(escritas.length, 0);
  });

  test("sem PROCESSOS_V2: Awaiting Payment nem é lido, B2B volta para a chave da conta", async () => {
    delete process.env.PROCESSOS_V2;
    const { client } = banco();
    const r = await varrerFeedbackPosJob(client, { agora: AGORA, lerZendesk: async () => null });
    const por = Object.fromEntries(r.linhas.map((l) => [l.reference, l]));
    assert.equal(por["JOB-F1"], undefined);
    assert.equal(por["JOB-N1"], undefined);
    // B1: conta com client_feedback_whatsapp = true, a regra antiga deixaria pedir.
    assert.equal(por["JOB-B1"].resultado, "enviaria");
  });
});
