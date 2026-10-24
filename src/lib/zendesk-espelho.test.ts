import { test } from "node:test";
import assert from "node:assert/strict";
import { donoDeTicketSemPedido, espelhoDaQuote, espelhoDoJob, mudancasNoTicket, papelDoStatus } from "./zendesk-espelho";
import {
  ZD_STATUS_AWAITING_PAYMENT, ZD_STATUS_COMPLAINT, ZD_STATUS_COMPLETED, ZD_STATUS_DEPOSIT_PENDING, ZD_STATUS_FINAL_CHECKS,
  ZD_STATUS_ON_HOLD, ZD_STATUS_PAYMENT_FAILED, ZD_STATUS_SCHEDULED, ZD_STATUS_UNASSIGNED, ZD_STATUS_BIDDING, ZD_STATUS_NEW, ZD_STATUS_LEAD, ZD_STATUS_PARTNER, ZD_STATUS_NO_BIDS,
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

test("cartão recusado: ⚠️ Payment failed, dono financeiro, sem ligar o Action Required", () => {
  const e = espelhoDoJob({ ...base, status: "awaiting_payment", motivos: ["card_declined"] as never[] })!;
  assert.equal(e.customStatusId, ZD_STATUS_PAYMENT_FAILED);
  assert.equal(e.actionRequired, null);
  assert.equal(e.papel, "financeiro");
});

test("Payment failed com o campo ligado de antes: o espelho desliga", () => {
  const e = espelhoDoJob({ ...base, status: "awaiting_payment", motivos: ["card_declined"] as never[] })!;
  const m = mudancasNoTicket(e, { status: "open", customStatusId: ZD_STATUS_PAYMENT_FAILED, assigneeId: VICTOR, actionRequired: "action_required_yes" }, dono);
  assert.equal(m.actionRequired, false);
});

test("Need attention vira 🟣 Final review no Zendesk, igual à aba do OS", () => {
  assert.equal(espelhoDoJob({ ...base, status: "need_attention" })!.customStatusId, ZD_STATUS_FINAL_CHECKS);
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

test("o OS fecha o ticket com What Happened e Closing Summary (o Zendesk exige)", () => {
  const e = espelhoDoJob({ ...base, status: "completed", referencia: "JOB-1" })!;
  assert.deepEqual(e.fechamento, { whatHappened: "job_completed", resumo: "Closed by the OS: JOB-1 is completed." });
  assert.equal(espelhoDoJob({ ...base, status: "cancelled" })!.fechamento!.whatHappened, "customer_cancelled");
  assert.equal(espelhoDaQuote("rejected")!.fechamento!.whatHappened, "quote_rejected");
  assert.equal(espelhoDoJob({ ...base, status: "scheduled" })!.fechamento, undefined);
});

test("ticket sem job nem quote: plataforma pedindo quote é vendas, o resto da plataforma é operação", () => {
  assert.equal(donoDeTicketSemPedido({ organizacao: "🏢 Housekeep", assunto: "[Housekeep] Painting quote request- SE3 9EY", customStatusId: ZD_STATUS_NEW }), "vendas");
  assert.equal(donoDeTicketSemPedido({ organizacao: "🏢 Housekeep", assunto: "[Housekeep] Job for tomorrow- IG1 2TE", customStatusId: ZD_STATUS_NEW }), "operacao");
  assert.equal(donoDeTicketSemPedido({ organizacao: "🏢 Housekeep", assunto: "[Housekeep] Handyman tomorrow: NW9 4DX", customStatusId: ZD_STATUS_NEW }), "operacao");
  assert.equal(donoDeTicketSemPedido({ organizacao: "Fixfy Customers", assunto: "Lead · Carpentry · Jo", customStatusId: ZD_STATUS_LEAD }), "vendas");
  assert.equal(donoDeTicketSemPedido({ organizacao: null, assunto: "Hi", customStatusId: ZD_STATUS_PARTNER }), "operacao");
  assert.equal(donoDeTicketSemPedido({ organizacao: "Li & Fung", assunto: "Your invoice INV-2026-904 is ready", customStatusId: ZD_STATUS_NEW }), "financeiro");
});

test("Bidding fica fora da fila nas primeiras 24h; sem lance em 24h vira 🔎 No Bids (vendas)", () => {
  assert.equal(espelhoDaQuote("bidding")!.customStatusId, ZD_STATUS_BIDDING);
  assert.equal(espelhoDaQuote("bidding", null)!.customStatusId, ZD_STATUS_BIDDING);
  const sem = espelhoDaQuote("bidding", "no_bids_reported")!;
  assert.equal(sem.customStatusId, ZD_STATUS_NO_BIDS);
  assert.equal(sem.papel, "vendas");
  assert.equal(papelDoStatus(ZD_STATUS_NO_BIDS), "vendas");
  assert.equal(espelhoDaQuote("quote_ready", "no_bids_reported")!.customStatusId === ZD_STATUS_NO_BIDS, false);
});
