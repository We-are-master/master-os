/**
 * Etapa do lead → ticket do Zendesk (fase 4 do CRM, desenho em docs/crm/).
 *
 * Só regra pura: a rotina scripts/espelho-leads.mts lê os tickets e grava em
 * lote. Vale para ticket de lead SEM quote nem job: esses o espelho de job e
 * quote (scripts/espelho-zendesk.mts) já cuida, e aqui não se briga com ele.
 *
 * O OS manda, o Zendesk espelha. Mas o lead só empurra o ticket quando ele está
 * num status "do funil de venda": job, reclamação, parceiro e financeiro ficam
 * onde estão (alguém pôs lá por um motivo que o lead não conhece).
 */
import type { LeadLostReason, LeadStage } from "@/types/database";
import {
  ZD_STATUS_AWAITING_APPROVAL,
  ZD_STATUS_BIDDING,
  ZD_STATUS_DEPOSIT_PENDING,
  ZD_STATUS_LEAD,
  ZD_STATUS_NEEDS_QUOTE,
  ZD_STATUS_NEW,
  ZD_STATUS_NO_BIDS,
  ZD_STATUS_OPEN,
  ZD_STATUS_QUOTE_READY,
  ZD_STATUS_TO_CALL,
  ZD_STATUS_WHATSAPP,
} from "@/lib/zendesk-statuses";

/** Prefixo das tags de etapa no ticket: uma só por vez (crm_new, crm_talking...). */
export const TAG_CRM = "crm_";

export function tagDaEtapa(stage: LeadStage): string {
  return `${TAG_CRM}${stage}`;
}

/** O que acrescentar e tirar para o ticket ficar com uma tag crm_* só, a da etapa. */
export function tagsDoLead(stage: LeadStage, tagsAtuais: readonly string[]): { add: string[]; remove: string[] } {
  const alvo = tagDaEtapa(stage);
  const remove = tagsAtuais.filter((t) => t.startsWith(TAG_CRM) && t !== alvo);
  const add = tagsAtuais.includes(alvo) ? [] : [alvo];
  return { add, remove };
}

/** Ticket que ainda não entrou em processo nenhum. */
const LIVRES = new Set<number>([ZD_STATUS_NEW, ZD_STATUS_OPEN, ZD_STATUS_WHATSAPP]);

/**
 * Status do funil de venda, na ordem em que o lead anda. O lead empurra o
 * ticket para a frente ou para o lado dentro desta família, nunca para fora.
 */
const FUNIL = [
  ZD_STATUS_LEAD,
  ZD_STATUS_TO_CALL,
  ZD_STATUS_NEEDS_QUOTE,
  ZD_STATUS_BIDDING,
  ZD_STATUS_NO_BIDS,
  ZD_STATUS_QUOTE_READY,
  ZD_STATUS_AWAITING_APPROVAL,
  ZD_STATUS_DEPOSIT_PENDING,
] as const;

/**
 * Por etapa: o status alvo e os status que já servem (sub-etapas que o Harvey
 * ou a equipe põem e que dizem a mesma coisa com mais detalhe). New lead e
 * Qualifying aceitam To Call e Needs Quote (o Harvey grava os dois ao passar
 * para a equipe) e Awaiting Approval (preço da equipe no chat, antes de o lead
 * andar no OS). Qualified = vez do closer: To Call até existir o status
 * Qualified no Zendesk.
 */
const POR_ETAPA: Partial<Record<LeadStage, { alvo: number; servem: number[] }>> = {
  new: { alvo: ZD_STATUS_LEAD, servem: [ZD_STATUS_LEAD, ZD_STATUS_TO_CALL, ZD_STATUS_NEEDS_QUOTE, ZD_STATUS_AWAITING_APPROVAL] },
  qualifying: { alvo: ZD_STATUS_LEAD, servem: [ZD_STATUS_LEAD, ZD_STATUS_TO_CALL, ZD_STATUS_NEEDS_QUOTE, ZD_STATUS_AWAITING_APPROVAL] },
  qualified: { alvo: ZD_STATUS_TO_CALL, servem: [ZD_STATUS_TO_CALL, ZD_STATUS_NEEDS_QUOTE, ZD_STATUS_AWAITING_APPROVAL] },
  quoting: { alvo: ZD_STATUS_NEEDS_QUOTE, servem: [ZD_STATUS_NEEDS_QUOTE, ZD_STATUS_BIDDING, ZD_STATUS_NO_BIDS, ZD_STATUS_QUOTE_READY] },
  quoted: { alvo: ZD_STATUS_AWAITING_APPROVAL, servem: [ZD_STATUS_AWAITING_APPROVAL, ZD_STATUS_DEPOSIT_PENDING] },
};

export type TicketDoLead = {
  /** status base do Zendesk: new, open, pending, hold, solved, closed */
  status: string | null;
  customStatusId: number | null;
  /** Campo Reply Status: reply_awaiting = o cliente escreveu e espera a gente. */
  replyStatus?: string | null;
  /** "ai_agent" enquanto o Harvey segura o ticket: só leitura. */
  supportType?: string | null;
};

export type AlvoDoTicket =
  | { kind: "status"; customStatusId: number }
  | { kind: "solved"; resolucao: string; resumo: string }
  | { kind: "nada"; motivo: string };

/** Resolução do formulário (campo Resolution) pelo motivo do Lost. */
function resolucaoDoLost(motivo: LeadLostReason | null | undefined): string {
  return motivo === "no_reply" ? "res_no_response" : "res_cancelled";
}

const MOTIVO_EM_INGLES: Record<LeadLostReason, string> = {
  price: "price",
  went_elsewhere: "went with someone else",
  timing: "timing",
  no_reply: "no reply",
  outside_area: "outside area",
  not_for_us: "not a job for us",
  duplicate: "duplicate",
  other: "other",
};

/**
 * O que o ticket do lead deve virar. Lost com data de volta (ex-Nurture) não
 * resolve o ticket: vai para o status `nurtureId` (ZENDESK_STATUS_NURTURE_ID,
 * on-hold) quando existe, e fica como está quando não existe.
 */
export function alvoDoTicketDoLead(
  lead: { stage: LeadStage; lostReason?: LeadLostReason | null; nurtureUntil?: string | null },
  t: TicketDoLead,
  nurtureId: number | null,
): AlvoDoTicket {
  if (t.status === "closed") return { kind: "nada", motivo: "ticket closed" };
  if (t.supportType === "ai_agent") return { kind: "nada", motivo: "Harvey is holding the ticket" };
  const atual = t.customStatusId;
  const resolvido = t.status === "solved";
  const doFunil = atual != null && (FUNIL as readonly number[]).includes(atual);
  const livre = atual == null || LIVRES.has(atual);
  const daNurture = nurtureId != null && atual === nurtureId;

  if (lead.stage === "won") return { kind: "nada", motivo: "won: the job mirror owns the ticket" };

  if (lead.stage === "lost" && lead.nurtureUntil) {
    if (resolvido) return { kind: "nada", motivo: "already solved" };
    if (nurtureId == null) return { kind: "nada", motivo: "lost with a come-back date: ZENDESK_STATUS_NURTURE_ID is not set" };
    if (daNurture) return { kind: "nada", motivo: "already mirrored" };
    if (!livre && !doFunil) return { kind: "nada", motivo: "ticket is outside the sales funnel" };
    return { kind: "status", customStatusId: nurtureId };
  }

  if (lead.stage === "lost") {
    if (resolvido) return { kind: "nada", motivo: "already solved" };
    if (t.replyStatus === "reply_awaiting") return { kind: "nada", motivo: "customer is waiting for a reply" };
    if (!livre && !doFunil && !daNurture) return { kind: "nada", motivo: "ticket is outside the sales funnel" };
    const motivo = MOTIVO_EM_INGLES[lead.lostReason ?? "other"];
    return { kind: "solved", resolucao: resolucaoDoLost(lead.lostReason), resumo: `Lead lost in the OS: ${motivo}.` };
  }

  // Ticket resolvido com o lead vivo: quem resolveu sabia de algo. Não reabre sozinho;
  // a resposta do cliente reabre o ticket e aí o espelho volta a valer.
  if (resolvido) return { kind: "nada", motivo: "solved in Zendesk with the lead open" };

  const regra = POR_ETAPA[lead.stage];
  if (!regra) return { kind: "nada", motivo: `no mapping for ${lead.stage}` };
  if (atual != null && regra.servem.includes(atual)) return { kind: "nada", motivo: "already mirrored" };
  if (!livre && !doFunil && !daNurture) return { kind: "nada", motivo: "ticket is outside the sales funnel" };
  return { kind: "status", customStatusId: regra.alvo };
}

/**
 * Sinal de resposta lido do campo Reply Status (para tickets sem webhook de
 * comentário, e-mail principalmente). "cliente": ele escreveu e o lead ainda
 * não sabe; "nossa": respondemos depois da resposta dele. null = nada novo.
 */
export function sinalDeResposta(replyStatus: string | null | undefined, clienteRespondeuEm: string | null | undefined): "cliente" | "nossa" | null {
  if (replyStatus === "reply_awaiting" && !clienteRespondeuEm) return "cliente";
  if (replyStatus === "reply_replied" && clienteRespondeuEm) return "nossa";
  return null;
}

/** 💤 Nurture: o dono cria no Zendesk (categoria on-hold) e põe o id aqui. Sem ele, Nurture não mexe no ticket. */
export function nurtureIdDoAmbiente(valor: string | undefined = process.env.ZENDESK_STATUS_NURTURE_ID): number | null {
  const n = Number(valor?.trim() || "");
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function hojeEmLondres(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}
