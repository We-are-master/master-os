/**
 * Etapas do CRM de Leads e Quotes (mig 356, desenho em docs/crm/).
 *
 * Lead e quote andam pela mesma lista. A etapa mora no lead; quando existe
 * quote, o status dela decide a etapa. Quem move é a aplicação, nunca trigger.
 * Aqui só regra pura, sem banco, para testar e reusar no OS, no Harvey e no
 * espelho do Zendesk.
 */
import type { LeadLostReason, LeadStage, LeadStatus, QuoteStatus } from "@/types/database";

export const LEAD_STAGES: readonly LeadStage[] = [
  "new",
  "talking",
  "quoting",
  "quote_sent",
  "accepted",
  "won",
  "lost",
  "nurture",
] as const;

/** Etapas em que o lead ainda pede ação (Fila Today, próximo passo). */
export const OPEN_STAGES: readonly LeadStage[] = ["new", "talking", "quoting", "quote_sent", "accepted"] as const;

export const STAGE_LABEL: Record<LeadStage, string> = {
  new: "New",
  talking: "Talking",
  quoting: "Quoting",
  quote_sent: "Quote sent",
  accepted: "Accepted",
  won: "Won",
  lost: "Lost",
  nurture: "Nurture",
};

export const LOST_REASON_LABEL: Record<LeadLostReason, string> = {
  price: "Price",
  went_elsewhere: "Went with someone else",
  timing: "Timing",
  no_reply: "No reply",
  outside_area: "Outside area",
  not_for_us: "Not a job for us",
  duplicate: "Duplicate",
  other: "Other",
};

export function isOpenStage(stage: LeadStage | null | undefined): boolean {
  return !!stage && OPEN_STAGES.includes(stage);
}

/** Status da quote → etapa do lead. */
export function stageFromQuoteStatus(status: QuoteStatus): LeadStage {
  switch (status) {
    case "draft":
    case "in_survey":
    case "bidding":
      return "quoting";
    case "quote_ready":
    case "awaiting_customer":
      return "quote_sent";
    case "awaiting_payment":
      return "accepted";
    case "converted_to_job":
      return "won";
    case "rejected":
      return "lost";
  }
}

/** Status antigo (tela de hoje) → etapa. */
export function stageFromLegacyStatus(status: LeadStatus): LeadStage {
  return status === "interested" ? "talking" : "new";
}

/** Etapa → status antigo, para a tela de hoje continuar coerente. */
export function legacyStatusFromStage(stage: LeadStage): LeadStatus {
  return stage === "new" ? "new" : "interested";
}

export type StageChange = {
  from: LeadStage;
  to: LeadStage;
  lostReason?: LeadLostReason | null;
  /** YYYY-MM-DD */
  nurtureUntil?: string | null;
  jobId?: string | null;
  /** YYYY-MM-DD de hoje em Londres; injetado para testar. */
  today?: string;
};

/** Devolve a mensagem de erro (em inglês, vai para a tela) ou null se pode. */
export function validateStageChange(c: StageChange): string | null {
  if (!LEAD_STAGES.includes(c.to)) return "Unknown stage";
  if (c.from === c.to) return null;
  if (c.from === "won") return "This lead is already a job";
  if (c.to === "lost" && !c.lostReason) return "Pick a reason to mark this lead as lost";
  if (c.to === "nurture") {
    if (!c.nurtureUntil || !/^\d{4}-\d{2}-\d{2}$/.test(c.nurtureUntil)) return "Pick a date to come back to this lead";
    const hoje = c.today ?? new Date().toISOString().slice(0, 10);
    if (c.nurtureUntil <= hoje) return "The come-back date must be in the future";
  }
  if (c.to === "won" && !c.jobId) return "A lead becomes won only when its job is created";
  return null;
}

/**
 * Quando o status antigo muda pela tela de hoje (new ↔ interested), só mexe
 * na etapa se o lead ainda está no começo do funil. Um lead em Quoting que
 * alguém marca "interested" não volta para Talking.
 */
export function stageForLegacyStatusChange(current: LeadStage, status: LeadStatus): LeadStage {
  if (current !== "new" && current !== "talking") return current;
  return stageFromLegacyStatus(status);
}
