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
  "qualified",
  "quoting",
  "quoted",
  "won",
  "lost",
] as const;

/** Etapas em que o lead ainda pede ação. */
export const OPEN_STAGES: readonly LeadStage[] = ["new", "qualified", "quoting", "quoted"] as const;

/** Etapas que a equipe move à mão no board (antes da quote existir). */
export const MANUAL_STAGES: readonly LeadStage[] = ["new", "qualified"] as const;

/** Mesmo nome no OS e no Zendesk (dicionário de nomes, 06/11/2026). */
export const STAGE_LABEL: Record<LeadStage, string> = {
  new: "New lead",
  qualified: "Qualified",
  quoting: "Quoting",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};

/** Tamanho máximo do nome de uma coluna renomeada no board. */
export const STAGE_LABEL_MAX = 24;

export type StageLabels = Record<LeadStage, string>;

/**
 * Nomes que a equipe deu às colunas (admin_config crm_stage_labels) → só o que
 * vale guardar: etapa conhecida, texto aparado, até 24 letras, diferente do
 * padrão. Vazio volta ao nome padrão. A etapa (id) nunca muda, só o rótulo.
 */
export function cleanStageLabels(input: unknown): Partial<StageLabels> {
  const out: Partial<StageLabels> = {};
  if (!input || typeof input !== "object") return out;
  for (const st of LEAD_STAGES) {
    const raw = (input as Record<string, unknown>)[st];
    if (typeof raw !== "string") continue;
    const v = raw.replace(/\s+/g, " ").trim().slice(0, STAGE_LABEL_MAX).trim();
    if (v && v !== STAGE_LABEL[st]) out[st] = v;
  }
  return out;
}

/** Nome de cada coluna: o da equipe, senão o padrão. */
export function mergeStageLabels(custom: Partial<StageLabels> | null | undefined): StageLabels {
  return { ...STAGE_LABEL, ...cleanStageLabels(custom) };
}

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

/**
 * Status da quote → etapa do lead. Quoting vai até a quote estar pronta para
 * enviar (Ready to send = parceiro cotou, falta a equipe mandar). Quoted só
 * quando o cliente tem o preço.
 */
export function stageFromQuoteStatus(status: QuoteStatus): LeadStage {
  switch (status) {
    case "draft":
    case "in_survey":
    case "bidding":
    case "quote_ready":
      return "quoting";
    case "awaiting_customer":
    case "awaiting_payment":
      return "quoted";
    case "converted_to_job":
      return "won";
    case "rejected":
      return "lost";
  }
}

/**
 * Status antigo (tela de hoje) → etapa. Qualifying saiu do funil (dono,
 * 06/11/2026): quem está juntando os dados continua em New lead.
 */
export function stageFromLegacyStatus(_status: LeadStatus): LeadStage {
  return "new";
}

/** Etapa → status antigo, para a tela de hoje continuar coerente. */
export function legacyStatusFromStage(stage: LeadStage): LeadStatus {
  return stage === "new" ? "new" : "interested";
}

export type StageChange = {
  from: LeadStage;
  to: LeadStage;
  lostReason?: LeadLostReason | null;
  /** YYYY-MM-DD: Lost com data de volta (ex-Nurture). */
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
  if (c.to === "lost" && c.nurtureUntil) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.nurtureUntil)) return "Pick a valid come-back date";
    const hoje = c.today ?? new Date().toISOString().slice(0, 10);
    if (c.nurtureUntil <= hoje) return "The come-back date must be in the future";
  }
  if (c.to === "won" && !c.jobId) return "A lead becomes won only when its job is created";
  return null;
}

/**
 * Quando o status antigo muda pela tela de hoje (new ↔ interested), só mexe
 * na etapa se o lead ainda está no começo do funil. Um lead em Quoting que
 * alguém marca "interested" não volta para New lead.
 */
export function stageForLegacyStatusChange(current: LeadStage, status: LeadStatus): LeadStage {
  if (current !== "new") return current;
  return stageFromLegacyStatus(status);
}
