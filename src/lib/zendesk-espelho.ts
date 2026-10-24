/**
 * O ticket espelha o OS (dono, 23/10/2026: "quem manda é o OS, o Zendesk apenas espelha").
 *
 * Para cada job ou quote ligado a um ticket, o OS decide três coisas e o Zendesk mostra:
 *
 *   status           a etapa do job (ou da quote), com duas etapas de dinheiro novas:
 *                    💳 Awaiting deposit (cotação aceita esperando a entrada) e
 *                    ⚠️ Payment failed (cartão recusado ou pedindo o banco)
 *   Action Required  o espelho NÃO liga mais (dono, 24/10/2026). O Action Required do
 *                    Zendesk é a fila de conversa (responder, Harvey, New/Open, No bids,
 *                    Ready to send); ⚠️ Payment failed é status e mora na view
 *                    💷 Awaiting payment. O campo é do Harvey (lances, perguntas,
 *                    revisão). O espelho só desliga o que ligava antes: ticket em
 *                    ⚠️ Payment failed ou saindo dele.
 *   dono             por papel, nunca por pessoa: vendas até virar job, operacao do job
 *                    e da reclamação, financeiro da cobrança. Só troca quando o ticket
 *                    MUDA de papel: quem assumiu à mão dentro da mesma etapa continua.
 *
 * Mexeram no ticket no Zendesk (fecharam com o job aberto, por exemplo)? A próxima
 * passada põe de volta o que o OS diz. A regra da equipe: fechou, cancelou ou perdeu,
 * faz no OS; o ticket fecha sozinho quando o OS fecha.
 *
 * Este arquivo é a parte pura (decide). Quem lê e escreve é `zendesk-status-sync.ts`.
 */
import type { JobStatus, QuoteStatus } from "@/types/database";
import type { Motivo } from "@/lib/pendencias/motivos";
import type { PapelDaEquipe } from "@/lib/responsavel-operacao";
import {
  ZD_STATUS_AUTO_ASSIGNING,
  ZD_STATUS_AWAITING_APPROVAL,
  ZD_STATUS_AWAITING_PAYMENT,
  ZD_STATUS_BIDDING,
  ZD_STATUS_COMPLAINT,
  ZD_STATUS_COMPLETED,
  ZD_STATUS_DEPOSIT_PENDING,
  ZD_STATUS_FINAL_CHECKS,
  ZD_STATUS_FINANCE,
  ZD_STATUS_IN_PROGRESS,
  ZD_STATUS_LEAD,
  ZD_STATUS_NEEDS_QUOTE,
  ZD_STATUS_NEW,
  ZD_STATUS_NO_BIDS,
  ZD_STATUS_ON_HOLD,
  ZD_STATUS_OPEN,
  ZD_STATUS_OVERDUE,
  ZD_STATUS_PARTNER,
  ZD_STATUS_PAYMENT_FAILED,
  ZD_STATUS_QUOTE_READY,
  ZD_STATUS_SCHEDULED,
  ZD_STATUS_TO_CALL,
  ZD_STATUS_UNASSIGNED,
} from "@/lib/zendesk-statuses";

export type PapelDoTicket = Extract<PapelDaEquipe, "vendas" | "operacao" | "financeiro">;

export type Espelho = {
  customStatusId: number;
  /** true = cobrança falhou; null = o espelho não mexe no campo. */
  actionRequired: true | null;
  /** A próxima ação, para a nota "⚡ Action Required: ..." quando liga. */
  proximaAcao: string | null;
  /** null = ticket encerrado: ninguém precisa ser dono. */
  papel: PapelDoTicket | null;
  /**
   * Ticket que o OS resolve: o Zendesk só aceita Solved com "What Happened" e
   * "Closing Summary" preenchidos (422 sem eles). Só entra onde o campo está vazio.
   */
  fechamento?: { whatHappened: string; resumo: string };
  /**
   * Campo "Payment" do ticket (24/10/2026): só vale enquanto o job está em Awaiting payment
   * (Unpaid ou Part paid, coluna da view 💷 Awaiting payment). null = apagar; ausente = não mexe.
   * Não muda status, dono nem Action Required.
   */
  pagamento?: ValorDoPagamento | null;
};

export const PAGAMENTO_NAO_PAGO = "payment_unpaid";
export const PAGAMENTO_EM_PARTE = "payment_part_paid";
export type ValorDoPagamento = typeof PAGAMENTO_NAO_PAGO | typeof PAGAMENTO_EM_PARTE;

const VENDAS = new Set<number>([
  ZD_STATUS_NEW, ZD_STATUS_OPEN, ZD_STATUS_LEAD, ZD_STATUS_TO_CALL, ZD_STATUS_NEEDS_QUOTE,
  ZD_STATUS_BIDDING, ZD_STATUS_NO_BIDS, ZD_STATUS_QUOTE_READY, ZD_STATUS_AWAITING_APPROVAL, ZD_STATUS_DEPOSIT_PENDING,
]);
const FINANCEIRO = new Set<number>([ZD_STATUS_AWAITING_PAYMENT, ZD_STATUS_OVERDUE, ZD_STATUS_PAYMENT_FAILED, ZD_STATUS_FINANCE]);
const OPERACAO = new Set<number>([
  ZD_STATUS_UNASSIGNED, ZD_STATUS_AUTO_ASSIGNING, ZD_STATUS_SCHEDULED, ZD_STATUS_IN_PROGRESS,
  ZD_STATUS_FINAL_CHECKS, ZD_STATUS_ON_HOLD, ZD_STATUS_COMPLAINT, ZD_STATUS_PARTNER,
]);

/** De que papel é um status do Zendesk (null = encerrado ou desconhecido). */
export function papelDoStatus(customStatusId: number | null | undefined): PapelDoTicket | null {
  if (customStatusId == null) return null;
  if (VENDAS.has(customStatusId)) return "vendas";
  if (FINANCEIRO.has(customStatusId)) return "financeiro";
  if (OPERACAO.has(customStatusId)) return "operacao";
  return null;
}

/** A etapa do job no Zendesk, sem as camadas de dinheiro e reclamação. */
export function statusDaEtapa(status: JobStatus): number | null {
  switch (status) {
    case "unassigned": return ZD_STATUS_UNASSIGNED;
    case "auto_assigning": return ZD_STATUS_AUTO_ASSIGNING;
    case "scheduled":
    case "late": return ZD_STATUS_SCHEDULED;
    // O OS mostra Need attention como "Final review" e põe na aba Final review (dono, 24/10/2026).
    case "need_attention": return ZD_STATUS_FINAL_CHECKS;
    case "in_progress": return ZD_STATUS_IN_PROGRESS;
    case "final_check": return ZD_STATUS_FINAL_CHECKS;
    case "awaiting_payment": return ZD_STATUS_AWAITING_PAYMENT;
    case "completed":
    case "cancelled": return ZD_STATUS_COMPLETED;
    case "on_hold": return ZD_STATUS_ON_HOLD;
    default: return null;
  }
}

const ENCERRADO = new Set<JobStatus>(["completed", "cancelled"]);
const CARTAO = new Set<Motivo>(["card_declined", "payment_unsuccessful"]);

export type EntradaDoJob = {
  /** O status já corrigido por `jobStatusForZendeskSync` (parceiro setado = scheduled). */
  status: JobStatus;
  /** Job de cotação esperando a entrada (a quote está em awaiting_payment). */
  esperandoEntrada: boolean;
  /** Motivos abertos em job_attention_reasons. */
  motivos: Motivo[];
  /** Fatura do job vencida (regra da aba Overdue do Finance). Só conta em Awaiting payment. */
  faturaVencida?: boolean;
  /** Parte do valor já entrou (finance_status partial). Só preenche o campo Payment. */
  pagoEmParte?: boolean;
  /** On hold por reclamação (`jobOnHoldPorReclamacao`). */
  reclamacao: boolean;
  /** O motivo do on hold, para a nota. */
  motivoDoOnHold?: string | null;
  /** JOB-1234, para o resumo de fechamento. */
  referencia?: string | null;
};

export function espelhoDoJob(j: EntradaDoJob): Espelho | null {
  const etapa = statusDaEtapa(j.status);
  if (etapa == null) return null;
  if (ENCERRADO.has(j.status)) {
    const fechamento = j.status === "completed"
      ? { whatHappened: "job_completed", resumo: `Closed by the OS: ${j.referencia ?? "the job"} is completed.` }
      : { whatHappened: "customer_cancelled", resumo: `Closed by the OS: ${j.referencia ?? "the job"} was cancelled.` };
    return { customStatusId: etapa, actionRequired: null, proximaAcao: null, papel: null, fechamento, pagamento: null };
  }

  let customStatusId = etapa;
  if (j.motivos.some((m) => CARTAO.has(m))) customStatusId = ZD_STATUS_PAYMENT_FAILED;
  else if (j.esperandoEntrada) customStatusId = ZD_STATUS_DEPOSIT_PENDING;
  else if (j.status === "on_hold" && j.reclamacao) customStatusId = ZD_STATUS_COMPLAINT;
  else if (j.status === "awaiting_payment" && j.faturaVencida) customStatusId = ZD_STATUS_OVERDUE;

  const pagamento = j.status === "awaiting_payment" ? (j.pagoEmParte ? PAGAMENTO_EM_PARTE : PAGAMENTO_NAO_PAGO) : null;
  return { customStatusId, actionRequired: null, proximaAcao: null, papel: papelDoStatus(customStatusId), pagamento };
}

/** A marca que o Harvey grava na quote quando passam 24h em Bidding sem lance. */
export const QUOTE_SEM_LANCE_24H = "no_bids_reported";

/**
 * Quote: só status e dono. O Action Required da quote é do Harvey (lances, perguntas).
 *
 * Bidding fica fora da fila nas primeiras 24h (dono, 23/10/2026): os parceiros estão
 * cotando. Passadas 24h sem lance (`automation_status = no_bids_reported`), o ticket
 * vira 🔎 No bids, que é status da view ⚡ Action Required.
 */
export function espelhoDaQuote(status: QuoteStatus, automationStatus?: string | null): Espelho | null {
  switch (status) {
    case "in_survey":
    case "bidding": {
      const semLance = status === "bidding" && automationStatus === QUOTE_SEM_LANCE_24H;
      return { customStatusId: semLance ? ZD_STATUS_NO_BIDS : ZD_STATUS_BIDDING, actionRequired: null, proximaAcao: null, papel: "vendas" };
    }
    case "quote_ready": return { customStatusId: ZD_STATUS_QUOTE_READY, actionRequired: null, proximaAcao: null, papel: "vendas" };
    case "awaiting_customer": return { customStatusId: ZD_STATUS_AWAITING_APPROVAL, actionRequired: null, proximaAcao: null, papel: "vendas" };
    case "awaiting_payment": return { customStatusId: ZD_STATUS_DEPOSIT_PENDING, actionRequired: null, proximaAcao: null, papel: "vendas" };
    case "rejected": return { customStatusId: ZD_STATUS_COMPLETED, actionRequired: null, proximaAcao: null, papel: null, fechamento: { whatHappened: "quote_rejected", resumo: "Closed by the OS: the quote was marked as lost." } };
    default: return null; // draft e converted_to_job não falam com o ticket
  }
}

export type TicketAtual = {
  status: string | null;
  customStatusId: number | null;
  assigneeId: number | null;
  actionRequired: string | null;
  /** Campo Reply Status: "reply_awaiting" = alguém escreveu e espera a nossa resposta. */
  replyStatus?: string | null;
  /** Campo Payment (payment_unpaid / payment_part_paid) ou null. */
  pagamento?: string | null;
};

const ENCERRADOS_NO_ZENDESK = new Set<number>([ZD_STATUS_COMPLETED]);

export type Mudanca = {
  customStatusId?: number;
  assigneeId?: number;
  /** true liga (com nota), false desliga (só o que o espelho ligou). */
  actionRequired?: boolean;
  /** Valor novo do campo Payment; null apaga. */
  pagamento?: ValorDoPagamento | null;
};

/**
 * O que precisa mudar no ticket para ele espelhar o OS. Vazio = já está igual.
 *
 * Dono: só quando o ticket muda de papel (ou está sem dono). Quem assumiu à mão dentro
 * da mesma etapa continua. Ticket encerrado não ganha dono novo.
 */
export function mudancasNoTicket(alvo: Espelho, atual: TicketAtual, donoDoPapel: (p: PapelDoTicket) => number): Mudanca {
  const m: Mudanca = {};
  // Nunca resolve uma conversa esperando resposta: a mensagem do cliente sumiria da fila.
  // Quando a equipe responder, a próxima passada fecha.
  const fecharia = ENCERRADOS_NO_ZENDESK.has(alvo.customStatusId);
  const conversaAberta = atual.replyStatus === "reply_awaiting";
  if (atual.customStatusId !== alvo.customStatusId && !(fecharia && conversaAberta)) m.customStatusId = alvo.customStatusId;
  if (alvo.papel) {
    const dono = donoDoPapel(alvo.papel);
    const trocouDePapel = papelDoStatus(atual.customStatusId) !== alvo.papel;
    if (atual.assigneeId == null || (trocouDePapel && atual.assigneeId !== dono)) m.assigneeId = dono;
  }
  const ligado = atual.actionRequired === "action_required_yes";
  if (alvo.actionRequired === true && !ligado) m.actionRequired = true;
  // Desliga só o que ele ligava até 24/10/2026: ticket em Payment failed ou saindo dele.
  // Payment failed agora mora na view 💷 Awaiting payment; o campo ligado o prenderia na fila de conversa.
  const tocaPaymentFailed = atual.customStatusId === ZD_STATUS_PAYMENT_FAILED || alvo.customStatusId === ZD_STATUS_PAYMENT_FAILED;
  if (alvo.actionRequired == null && ligado && tocaPaymentFailed) m.actionRequired = false;
  if (alvo.pagamento !== undefined && (atual.pagamento ?? null) !== alvo.pagamento) m.pagamento = alvo.pagamento;
  return m;
}

// ─── Ticket ainda sem job nem quote ─────────────────────────────────────────

/** As plataformas que mandam o trabalho pronto (preço delas): o pedido já vem vendido. */
const PLATAFORMA = /housekeep|express|fantastic/i;
const PEDE_COTACAO = /\b(quot(e|es|ation|ing)|estimates?)\b/i;
const COBRANCA = /\b(invoices?|payments?|receipts?|overdue|remittance)\b/i;

/**
 * Dono de ticket aberto SEM dono e sem job nem quote (dono, 23/10/2026). Nunca troca
 * dono de ninguém, só preenche o vazio:
 *
 *   plataforma pedindo quote             vendas
 *   plataforma, qualquer outra coisa     operacao (disponibilidade, job de amanhã, remarcação, problema)
 *   🟢 Partner / 🚨 Complaint            operacao
 *   fatura, pagamento, recibo            financeiro
 *   o resto (lead, cliente direto)       vendas
 */
export function donoDeTicketSemPedido(t: { organizacao: string | null; assunto: string | null; customStatusId: number | null }): PapelDoTicket {
  if (t.customStatusId === ZD_STATUS_PARTNER || t.customStatusId === ZD_STATUS_COMPLAINT) return "operacao";
  if (COBRANCA.test(t.assunto ?? "")) return "financeiro";
  if (PLATAFORMA.test(t.organizacao ?? "")) return PEDE_COTACAO.test(t.assunto ?? "") ? "vendas" : "operacao";
  return "vendas";
}

/**
 * O formulário do job no ticket (Job ID, cliente, endereço, tipo de trabalho) ficou vazio?
 *
 * Caso JOB-9790 (dono, 23/10/2026): o job nasceu do pagamento no WhatsApp no ticket
 * da conversa enquanto ele ainda era "AI agent" (só leitura). O Zendesk recusou o
 * formulário, e quando o ticket virou ticket normal ninguém tentou de novo: o espelho
 * só mexia em status, dono e Action Required. Agora o espelho preenche o que ficou
 * vazio. Só o VAZIO: ticket com dois jobs já tem um Job ID, e trocar faria o campo
 * pular de um para o outro a cada passada.
 */
export function formularioDoJobFaltando(t: {
  status: string | null | undefined;
  supportType: string | null | undefined;
  jobIdNoTicket: unknown;
  referencia: string | null | undefined;
}): boolean {
  if (!String(t.referencia ?? "").trim()) return false;
  if (t.status === "closed") return false;
  if (t.supportType === "ai_agent") return false;
  return !String(t.jobIdNoTicket ?? "").trim();
}
