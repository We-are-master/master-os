import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { regrasDoProcesso, tipoDaConta } from "./conta";
import { motivosDoJob, type JobParaPendencias } from "@/lib/pendencias/motivos";
import { chaveDeEnvio, confirmarEnvio, falhouEnvio, primeiraVezDoEvento, reservarEnvio } from "@/lib/idempotencia/envio";

describe("tipo de processo da conta", () => {
  it("lê a coluna quando ela vem", () => assert.equal(tipoDaConta({ id: "x", process_type: "b2b" }), "b2b"));
  it("cai no UUID conhecido quando a coluna falta", () => {
    assert.equal(tipoDaConta({ id: "9659bbfb-eb56-4a31-9773-7f5e1335d0b4" }), "platform"); // Housekeep
    assert.equal(tipoDaConta({ id: "5CF896EC-EE42-441B-A698-34FDAEEB28B3" }), "direct"); // Fixfy, maiúsculas
  });
  it("conta desconhecida sem coluna não vira nada (não supõe)", () => assert.equal(tipoDaConta({ id: "abc" }), null));
  it("padrões por tipo", () => {
    assert.equal(regrasDoProcesso("direct").agendarSoComSinal, false, "entrada não trava o agendamento (dono, 22/10/2026)");
    assert.equal(regrasDoProcesso("direct", { schedule_requires_deposit: true }).agendarSoComSinal, true);
    assert.equal(regrasDoProcesso("platform").cobraDoCliente, false);
    assert.equal(regrasDoProcesso("platform").feedback, "depois_do_pagamento_da_plataforma");
    assert.equal(regrasDoProcesso("b2b").conducaoDaQuote, "humana");
  });
  it("exceções da conta valem e chaves estranhas são ignoradas", () => {
    const r = regrasDoProcesso("platform", { channels: ["email"], schedule_requires_deposit: true, qualquer: 1 } as never);
    assert.deepEqual(r.canais, ["email"]);
    assert.equal(r.agendarSoComSinal, true);
    assert.equal(regrasDoProcesso("b2b", { b2b_human_only: false }).conducaoDaQuote, "automatica");
  });
  it("fluxos novos só com as duas chaves", () => {
    const antes = process.env.PROCESSOS_V2;
    delete process.env.PROCESSOS_V2;
    assert.equal(regrasDoProcesso("direct", { v2: true }).v2, false);
    process.env.PROCESSOS_V2 = "on";
    assert.equal(regrasDoProcesso("direct", { v2: true }).v2, true);
    assert.equal(regrasDoProcesso("direct", {}).v2, false);
    if (antes === undefined) delete process.env.PROCESSOS_V2; else process.env.PROCESSOS_V2 = antes;
  });
  it("não compartilha a lista de canais entre chamadas", () => {
    regrasDoProcesso("direct").canais.push("sms" as never);
    assert.deepEqual(regrasDoProcesso("direct").canais, ["email", "whatsapp"]);
  });
});

describe("motivos de Action Required", () => {
  const fixfy = regrasDoProcesso("direct");
  const housekeep = regrasDoProcesso("platform");
  const base: JobParaPendencias = { status: "scheduled", scheduled_date: "2026-10-25", partner_id: "p1", client_price: 180, partner_cost: 117, customer_deposit: 90, customer_deposit_paid: true };

  it("job em ordem não tem pendência", () => assert.deepEqual(motivosDoJob(base, fixfy), []));
  it("com parceiro e sem data aparece (Date TBC)", () => assert.deepEqual(motivosDoJob({ ...base, scheduled_date: null }, fixfy), ["date_tbc"]));
  it("sem parceiro aparece", () => assert.ok(motivosDoJob({ ...base, status: "unassigned", partner_id: null }, fixfy).includes("partner_required")));
  it("sinal pendente só no fluxo com sinal", () => {
    const j = { ...base, customer_deposit_paid: false };
    assert.ok(motivosDoJob(j, fixfy).includes("deposit_pending"));
    assert.ok(!motivosDoJob(j, housekeep).includes("deposit_pending"));
  });
  it("reserva já paga não pede sinal", () => assert.ok(!motivosDoJob({ ...base, customer_deposit_paid: false, finance_status: "paid" }, fixfy).includes("deposit_pending")));
  it("cartão recusado vira Payment Unsuccessful no 7º dia", () => {
    const j = { ...base, status: "awaiting_payment", card_charge_status: "refused" };
    assert.ok(motivosDoJob(j, fixfy, { diasDesdeARecusa: 3 }).includes("card_declined"));
    assert.ok(motivosDoJob(j, fixfy, { diasDesdeARecusa: 7 }).includes("payment_unsuccessful"));
    assert.ok(!motivosDoJob({ ...j, finance_status: "paid" }, fixfy).includes("card_declined"));
  });
  it("final check sem report e need attention", () => {
    assert.ok(motivosDoJob({ ...base, status: "final_check", final_report_submitted: false }, fixfy).includes("report_incomplete"));
    // JOB-9695 (22/10/2026): o portal marca report_1_uploaded, não final_report_submitted.
    assert.ok(!motivosDoJob({ ...base, status: "final_check", report_1_uploaded: true }, fixfy).includes("report_incomplete"));
    assert.ok(motivosDoJob({ ...base, status: "need_attention" }, fixfy).includes("human_review_required"));
  });
  it("preço e custo ausentes são pendência, não estimativa", () => {
    const m = motivosDoJob({ ...base, client_price: null, partner_cost: 0 }, housekeep);
    assert.ok(m.includes("price_missing") && m.includes("partner_cost_missing"));
  });
  it("depois da execução, data a confirmar não é pendência", () => assert.ok(!motivosDoJob({ ...base, status: "awaiting_payment", scheduled_date: null }, fixfy).includes("date_tbc")));
  it("job encerrado não tem pendência", () => assert.deepEqual(motivosDoJob({ ...base, status: "completed", scheduled_date: null }, fixfy), []));
});

/** Banco falso: só o que reservarEnvio e primeiraVezDoEvento usam, com o 23505 do Postgres. */
function bancoFalso() {
  const tabelas: Record<string, Map<string, Record<string, unknown>>> = { outbound_messages: new Map(), processed_events: new Map() };
  const chaveDe = (t: string, r: Record<string, unknown>) => (t === "outbound_messages" ? String(r.dedupe_key) : `${r.provider}|${r.event_id}`);
  const sb = {
    from(t: string) {
      const tab = tabelas[t];
      const filtros: Array<[string, unknown]> = [];
      let patch: Record<string, unknown> | null = null;
      const casa = (r: Record<string, unknown>) => filtros.every(([c, v]) => r[c] === v);
      const q = {
        insert(r: Record<string, unknown>) {
          const k = chaveDe(t, r);
          if (tab.has(k)) return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
          tab.set(k, { ...r });
          return Promise.resolve({ error: null });
        },
        update(p: Record<string, unknown>) { patch = p; return q; },
        select() { return q; },
        eq(c: string, v: unknown) { filtros.push([c, v]); return q; },
        maybeSingle() { return Promise.resolve({ data: [...tab.values()].find(casa) ?? null }); },
        then(ok: (v: { data: unknown[]; error: null }) => unknown) {
          const linhas = [...tab.values()].filter(casa);
          if (patch) for (const l of linhas) Object.assign(l, patch);
          return Promise.resolve({ data: linhas.map((l) => ({ ...l })), error: null }).then(ok);
        },
      };
      return q;
    },
  };
  return { sb: sb as unknown as SupabaseClient, tabelas };
}

describe("reserva de envio", () => {
  const pedido = { chave: chaveDeEnvio("lembrete-24h", "job1", "2026-10-25"), finalidade: "lembrete-24h", canal: "whatsapp" as const, jobId: "job1" };

  it("a primeira rodada reserva, a segunda não manda", async () => {
    const { sb } = bancoFalso();
    assert.equal((await reservarEnvio(sb, pedido)).reservado, true);
    assert.equal((await reservarEnvio(sb, pedido)).reservado, false);
  });
  it("depois de enviado nunca mais reserva", async () => {
    const { sb } = bancoFalso();
    await reservarEnvio(sb, pedido);
    await confirmarEnvio(sb, pedido.chave, "wamid.1");
    const r = await reservarEnvio(sb, pedido, new Date(Date.now() + 86_400_000));
    assert.equal(r.reservado, false);
    assert.equal(r.motivo, "already sent");
  });
  it("falhou libera para a próxima rodada", async () => {
    const { sb } = bancoFalso();
    await reservarEnvio(sb, pedido);
    await falhouEnvio(sb, pedido.chave, new Error("131048"));
    assert.equal((await reservarEnvio(sb, pedido)).reservado, true);
  });
  it("reserva presa é retomada só depois de 30 min", async () => {
    const { sb } = bancoFalso();
    const t0 = new Date("2026-10-22T10:00:00Z");
    await reservarEnvio(sb, pedido, t0);
    assert.equal((await reservarEnvio(sb, pedido, new Date("2026-10-22T10:10:00Z"))).reservado, false);
    assert.equal((await reservarEnvio(sb, pedido, new Date("2026-10-22T10:31:00Z"))).reservado, true);
  });
  it("evento repetido do webhook é processado uma vez", async () => {
    const { sb } = bancoFalso();
    assert.equal(await primeiraVezDoEvento(sb, "stripe", "evt_1"), true);
    assert.equal(await primeiraVezDoEvento(sb, "stripe", "evt_1"), false);
    assert.equal(await primeiraVezDoEvento(sb, "stripe", "evt_2"), true);
  });
});
