/**
 * Scheduled só com parceiro, data e sinal (conta direct v2). A mesma regra está no
 * gatilho da migration 347.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { podeAgendar, exigeSinalParaAgendar } from "./agendamento";
import type { RegrasDoProcesso } from "./conta";

const fixfyV2: Pick<RegrasDoProcesso, "v2" | "tipo" | "agendarSoComSinal"> = { v2: true, tipo: "direct", agendarSoComSinal: true };

test("com parceiro e sem data: barra pela data", () => {
  const r = podeAgendar({ partner_id: "p1", scheduled_date: null, scheduled_start_at: null, customer_deposit: 100, customer_deposit_paid: true }, fixfyV2, "JOB-1");
  assert.equal(r.pode, false);
  assert.deepEqual(r.faltando, ["confirmed_date"]);
  assert.equal(r.pode === false && r.mensagem, "JOB-1 cannot be scheduled yet: it needs a confirmed date.");
});

test("sinal pendente barra, mesmo com parceiro e data", () => {
  const r = podeAgendar({ partner_id: "p1", scheduled_date: "2026-10-30", customer_deposit: 120, customer_deposit_paid: false, finance_status: "unpaid" }, fixfyV2);
  assert.equal(r.pode, false);
  assert.deepEqual(r.faltando, ["deposit"]);
});

test("nada preenchido: lista as três faltas numa frase sem travessão", () => {
  const r = podeAgendar({}, fixfyV2, "JOB-2");
  assert.equal(r.pode, false);
  assert.deepEqual(r.faltando, ["partner", "confirmed_date", "deposit"]);
  const msg = r.pode === false ? r.mensagem : "";
  assert.equal(msg, "JOB-2 cannot be scheduled yet: it needs a partner, a confirmed date and the deposit paid.");
  assert.doesNotMatch(msg, /—/);
});

test("reserva do site paga por inteiro: entra sem sinal marcado", () => {
  const r = podeAgendar({ partner_id: "p1", scheduled_start_at: "2026-10-30T08:00:00Z", customer_deposit: 0, customer_deposit_paid: false, finance_status: "paid" }, fixfyV2);
  assert.deepEqual(r, { pode: true, faltando: [] });
});

test("sinal pago com parceiro e data: entra", () => {
  assert.equal(podeAgendar({ partner_id: "p1", scheduled_date: "2026-10-30", customer_deposit: 100, customer_deposit_paid: true }, fixfyV2).pode, true);
});

test("plataforma nunca é barrada (nem com regra forçada); B2B e conta sem v2 também não", () => {
  assert.equal(podeAgendar({}, { v2: true, tipo: "platform", agendarSoComSinal: false }).pode, true);
  assert.equal(podeAgendar({}, { v2: true, tipo: "platform", agendarSoComSinal: true }).pode, true);
  assert.equal(podeAgendar({}, { v2: true, tipo: "b2b", agendarSoComSinal: false }).pode, true);
  assert.equal(podeAgendar({}, { v2: false, tipo: "direct", agendarSoComSinal: true }).pode, true);
  assert.equal(podeAgendar({}, null).pode, true);
  assert.equal(exigeSinalParaAgendar({ v2: true, tipo: "direct", agendarSoComSinal: false }), false);
});
