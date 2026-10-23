/**
 * O ticket espelha o OS (dono, 23/10/2026: "quem manda é o OS, o Zendesk apenas espelha").
 *
 * Para cada job ou quote ligado a um ticket, o OS decide três coisas e o Zendesk mostra:
 *
 *   status           a etapa do job (ou da quote), com duas etapas de dinheiro novas:
 *                    💳 Deposit Pending (cotação aceita esperando a entrada) e
 *                    ⚠️ Payment Failed (cartão recusado ou pedindo o banco)
 *   Action Required  SÓ cobrança que falhou (cartão recusado ou pedindo o banco, na
 *                    entrada ou no saldo). O Action Required do Zendesk NÃO é a aba do
 *                    OS (dono, 23/10/2026): Unassigned, On hold e os outros motivos
 *                    ficam no Jobs do OS, e o resto do campo é do Harvey (lances,
 *                    perguntas, revisão). O espelho só liga por pagamento e só desliga
 *                    o que ele mesmo ligou (ticket saindo de ⚠️ Payment Failed).
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
import { ROTULO_DO_MOTIVO, type Motivo } from "@/lib/pendencias/motivos";
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
  ZD_STATUS_ON_HOLD,
  ZD_STATUS_OPEN,
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
};

const VENDAS = new Set<number>([
  ZD_STATUS_NEW, ZD_STATUS_OPEN, ZD_STATUS_LEAD, ZD_STATUS_TO_CALL, ZD_STATUS_NEEDS_QUOTE,
  ZD_STATUS_BIDDING, ZD_STATUS_QUOTE_READY, ZD_STATUS_AWAITING_APPROVAL, ZD_STATUS_DEPOSIT_PENDING,
]);
const FINANCEIRO = new Set<number>([ZD_STATUS_AWAITING_PAYMENT, ZD_STATUS_PAYMENT_FAILED, ZD_STATUS_FINANCE]);
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
    case "late":
    case "need_attention": return ZD_STATUS_SCHEDULED;
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
  /** On hold por reclamação (`jobOnHoldPorReclamacao`). */
  reclamacao: boolean;
  /** O motivo do on hold, para a nota. */
  motivoDoOnHold?: string | null;
};

export function espelhoDoJob(j: EntradaDoJob): Espelho | null {
  const etapa = statusDaEtapa(j.status);
  if (etapa == null) return null;
  if (ENCERRADO.has(j.status)) return { customStatusId: etapa, actionRequired: null, proximaAcao: null, papel: null };

  let customStatusId = etapa;
  if (j.motivos.some((m) => CARTAO.has(m))) customStatusId = ZD_STATUS_PAYMENT_FAILED;
  else if (j.esperandoEntrada) customStatusId = ZD_STATUS_DEPOSIT_PENDING;
  else if (j.status === "on_hold" && j.reclamacao) customStatusId = ZD_STATUS_COMPLAINT;

  const cartao = j.motivos.filter((m) => CARTAO.has(m));
  const actionRequired = cartao.length > 0 ? true : null;
  const proximaAcao = cartao.length > 0 ? `${cartao.map((m) => ROTULO_DO_MOTIVO[m]).join(" · ")}: chase the payment (see the job in the OS)` : null;

  return { customStatusId, actionRequired, proximaAcao, papel: papelDoStatus(customStatusId) };
}

/** Quote: só status e dono. O Action Required da quote é do Harvey (lances, perguntas). */
export function espelhoDaQuote(status: QuoteStatus): Espelho | null {
  switch (status) {
    case "in_survey":
    case "bidding": return { customStatusId: ZD_STATUS_BIDDING, actionRequired: null, proximaAcao: null, papel: "vendas" };
    case "quote_ready": return { customStatusId: ZD_STATUS_QUOTE_READY, actionRequired: null, proximaAcao: null, papel: "vendas" };
    case "awaiting_customer": return { customStatusId: ZD_STATUS_AWAITING_APPROVAL, actionRequired: null, proximaAcao: null, papel: "vendas" };
    case "awaiting_payment": return { customStatusId: ZD_STATUS_DEPOSIT_PENDING, actionRequired: null, proximaAcao: null, papel: "vendas" };
    case "rejected": return { customStatusId: ZD_STATUS_COMPLETED, actionRequired: null, proximaAcao: null, papel: null };
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
};

const ENCERRADOS_NO_ZENDESK = new Set<number>([ZD_STATUS_COMPLETED]);

export type Mudanca = {
  customStatusId?: number;
  assigneeId?: number;
  /** true liga (com nota), false desliga (só o que o espelho ligou). */
  actionRequired?: boolean;
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
  // Desliga só o que ele ligou: o ticket estava em Payment Failed e a cobrança se resolveu.
  const saiuDoPaymentFailed = atual.customStatusId === ZD_STATUS_PAYMENT_FAILED && alvo.customStatusId !== ZD_STATUS_PAYMENT_FAILED;
  if (alvo.actionRequired == null && ligado && saiuDoPaymentFailed) m.actionRequired = false;
  return m;
}
