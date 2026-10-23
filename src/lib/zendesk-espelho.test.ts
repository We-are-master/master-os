import { test } from "node:test";
import assert from "node:assert/strict";
import { espelhoDaQuote, espelhoDoJob, mudancasNoTicket, papelDoStatus } from "./zendesk-espelho";
import {
  ZD_STATUS_AWAITING_PAYMENT, ZD_STATUS_COMPLAINT, ZD_STATUS_COMPLETED, ZD_STATUS_DEPOSIT_PENDING, ZD_STATUS_FINAL_CHECKS,
  ZD_STATUS_ON_HOLD, ZD_STATUS_PAYMENT_FAILED, ZD_STATUS_SCHEDULED, ZD_STATUS_UNASSIGNED, ZD_STATUS_BIDDING,
} from "./zendesk-statuses";

const base: { esperandoEntrada: boolean; motivos: never[]; reclamacao: boolean } = { esperandoEntrada: false, motivos: [], reclamacao: false };
const VICTOR = 1, LEO = 2;
const dono = (p: string) => (p === "operacao" ? LEO : VICTOR);

test("etapa de execução: status do job, espelho não mexe no Action Required, dono operação", () => {
  const e = espelhoDoJob({ ...base, status: "scheduled" })!;
  assert.equal(e.customStatusId, ZD_STATUS_SCHEDULED);
  assert.equal(e.actionRequired, null);
  assert.equal(e.papel, "operacao");
});

test("Unassigned e On hold ficam só no Jobs do OS: o Action Required do Zendesk não liga", () => {
  assert.equal(espelhoDoJob({ ...base, status: "unassigned" })!.actionRequired, null);
  const h = espelhoDoJob({ ...base, status: "on_hold", motivoDoOnHold: "Waiting for customer" })!;
  assert.equal(h.customStatusId, ZD_STATUS_ON_HOLD);
  assert.equal(h.actionRequired, null);
});

test("reclamação: On hold vira 🚨 Complaint", () => {
  assert.equal(espelhoDoJob({ ...base, status: "on_hold", reclamacao: true })!.customStatusId, ZD_STATUS_COMPLAINT);
});

test("cartão recusado: ⚠️ Payment Failed, Action Required, dono financeiro", () => {
  const e = espelhoDoJob({ ...base, status: "awaiting_payment", motivos: ["card_declined"] as never[] })!;
  assert.equal(e.customStatusId, ZD_STATUS_PAYMENT_FAILED);
  assert.equal(e.actionRequired, true);
  assert.equal(e.papel, "financeiro");
});

test("cotação aceita esperando a entrada: 💳 Deposit Pending, dono vendas", () => {
  const e = espelhoDoJob({ ...base, status: "unassigned", esperandoEntrada: true })!;
  assert.equal(e.customStatusId, ZD_STATUS_DEPOSIT_PENDING);
  assert.equal(e.papel, "vendas");
});

test("motivo que não é cobrança (report, data, preço) não liga o Action Required do Zendesk", () => {
  const e = espelhoDoJob({ ...base, status: "final_check", motivos: ["report_incomplete", "date_tbc"] as never[] })!;
  assert.equal(e.customStatusId, ZD_STATUS_FINAL_CHECKS);
  assert.equal(e.actionRequired, null);
});

test("cobrança resolvida: sai de Payment Failed e desliga o que o espelho ligou", () => {
  const pago = espelhoDoJob({ ...base, status: "awaiting_payment" })!;
  const m = mudancasNoTicket(pago, { status: "open", customStatusId: ZD_STATUS_PAYMENT_FAILED, assigneeId: VICTOR, actionRequired: "action_required_yes" }, dono);
  assert.equal(m.actionRequired, false);
});

test("Action Required ligado pelo Harvey em outra etapa: o espelho não desliga", () => {
  const agendado = espelhoDoJob({ ...base, status: "scheduled" })!;
  const m = mudancasNoTicket(agendado, { status: "open", customStatusId: ZD_STATUS_SCHEDULED, assigneeId: LEO, actionRequired: "action_required_yes" }, dono);
  assert.deepEqual(m, {});
});

test("encerrado: Solved, Action Required desligado, ninguém vira dono", () => {
  for (const status of ["completed", "cancelled"] as const) {
    const e = espelhoDoJob({ ...base, status })!;
    assert.equal(e.customStatusId, ZD_STATUS_COMPLETED);
    assert.equal(e.actionRequired, null);
    assert.equal(e.papel, null);
  }
});

test("quote: Bidding com dono vendas, sem opinar no Action Required; draft não fala", () => {
  const q = espelhoDaQuote("bidding")!;
  assert.equal(q.customStatusId, ZD_STATUS_BIDDING);
  assert.equal(q.actionRequired, null);
  assert.equal(q.papel, "vendas");
  assert.equal(espelhoDaQuote("draft"), null);
});

test("Leo fechou o ticket com o job em Final Checks: volta para Final Checks", () => {
  const alvo = espelhoDoJob({ ...base, status: "final_check" })!;
  const m = mudancasNoTicket(alvo, { status: "solved", customStatusId: ZD_STATUS_COMPLETED, assigneeId: LEO, actionRequired: null }, dono);
  assert.equal(m.customStatusId, ZD_STATUS_FINAL_CHECKS);
  assert.equal(m.assigneeId, undefined); // já era do Leo
});

test("dono troca quando o ticket muda de papel; dentro da mesma etapa, quem assumiu fica", () => {
  const pago = espelhoDoJob({ ...base, status: "awaiting_payment" })!;
  const m = mudancasNoTicket(pago, { status: "open", customStatusId: ZD_STATUS_FINAL_CHECKS, assigneeId: LEO, actionRequired: null }, dono);
  assert.equal(m.customStatusId, ZD_STATUS_AWAITING_PAYMENT);
  assert.equal(m.assigneeId, VICTOR);

  const agendado = espelhoDoJob({ ...base, status: "scheduled" })!;
  const fica = mudancasNoTicket(agendado, { status: "open", customStatusId: ZD_STATUS_UNASSIGNED, assigneeId: 99, actionRequired: "action_required_yes" }, dono);
  assert.equal(fica.assigneeId, undefined);
  assert.equal(fica.actionRequired, undefined);
});

test("já espelhado: nada a escrever; sem dono ganha dono", () => {
  const alvo = espelhoDoJob({ ...base, status: "scheduled" })!;
  assert.deepEqual(mudancasNoTicket(alvo, { status: "open", customStatusId: ZD_STATUS_SCHEDULED, assigneeId: LEO, actionRequired: "action_required_no" }, dono), {});
  assert.equal(mudancasNoTicket(alvo, { status: "open", customStatusId: ZD_STATUS_SCHEDULED, assigneeId: null, actionRequired: null }, dono).assigneeId, LEO);
});

test("papel de cada status", () => {
  assert.equal(papelDoStatus(ZD_STATUS_BIDDING), "vendas");
  assert.equal(papelDoStatus(ZD_STATUS_PAYMENT_FAILED), "financeiro");
  assert.equal(papelDoStatus(ZD_STATUS_COMPLAINT), "operacao");
  assert.equal(papelDoStatus(ZD_STATUS_COMPLETED), null);
});

test("job encerrado com o cliente esperando resposta: o espelho não resolve o ticket", () => {
  const alvo = espelhoDoJob({ ...base, status: "completed" })!;
  const espera = mudancasNoTicket(alvo, { status: "open", customStatusId: ZD_STATUS_SCHEDULED, assigneeId: LEO, actionRequired: null, replyStatus: "reply_awaiting" }, dono);
  assert.equal(espera.customStatusId, undefined);
  const respondido = mudancasNoTicket(alvo, { status: "open", customStatusId: ZD_STATUS_SCHEDULED, assigneeId: LEO, actionRequired: null, replyStatus: "reply_replied" }, dono);
  assert.equal(respondido.customStatusId, ZD_STATUS_COMPLETED);
});
