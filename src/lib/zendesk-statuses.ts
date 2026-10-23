/**
 * Zendesk custom_status_id values for the Master OS Quote/Job lifecycle.
 *
 * Source of truth: Zendesk admin UI (custom statuses).
 * Fetched via GET /api/v2/custom_statuses.json on the master.zendesk.com account.
 *
 * The OS is the operational source-of-truth — these IDs are how we mirror OS
 * state onto the customer-facing ticket so support agents see the same state
 * as the operations team.
 */

// ─── Quote lifecycle ─────────────────────────────────────────────────────────

/**
 * 🟢 Quote Ready — os lances chegaram, o preço está calculado e o rascunho está
 * na thread. Ninguém enviou ao cliente ainda.
 *
 * Era "🟠 Ready to Quote" (pedido chegou, ninguém cotou) e foi renomeado em
 * 09/09/2026 a pedido do dono, com ZERO tickets naquele estado. O id é o mesmo;
 * o que mudou foi o significado, que passou do começo do funil para o fim.
 *
 * Entra no Action Required junto com Final Checks: quote pronta e não enviada é
 * trabalho parado esperando gente.
 */
export const ZD_STATUS_QUOTE_READY = 5688507034015;

/** 🟤 Bidding — partners are being asked for prices. */
export const ZD_STATUS_BIDDING = 5688282472223;

/** 🟠 Awaiting Approval — quote PDF was sent to the customer; we're waiting for accept/reject. */
export const ZD_STATUS_AWAITING_APPROVAL = 5688280626847;

/** 🔴 Lost — quote was rejected or did not convert after follow-up. Solved category. */
/**
 * 🔴 Lost está DESATIVADO no Zendesk (levantamento de 23/10/2026): o PUT com ele não
 * pega e a quote perdida ficava sem espelho. Vai para Solved, como o Leo já fecha à mão.
 */
export const ZD_STATUS_LOST = 5679178036383;

// ─── Job lifecycle ───────────────────────────────────────────────────────────

/** 🔴 Unassigned — job exists, no partner assigned yet (waiting on auto-assign or manual). */
export const ZD_STATUS_UNASSIGNED = 5688450872991;

/** 🟡 Auto-Assigning — job is broadcasting to partners for auto-assignment.
 *  Distinct from Unassigned. Overridable via env; falls back to Unassigned. */
export const ZD_STATUS_AUTO_ASSIGNING =
  Number(process.env.ZENDESK_STATUS_AUTO_ASSIGNING_ID?.trim() || "5838176584223") || ZD_STATUS_UNASSIGNED;

/** 🟢 Schedule — job is assigned & scheduled. */
export const ZD_STATUS_SCHEDULED = 5688453749919;

/** 🔵 In Progress — partner started the job. */
export const ZD_STATUS_IN_PROGRESS = 5679191543711;

/** 🟣 Final Checks — job is done in the field; awaiting report / final review. */
export const ZD_STATUS_FINAL_CHECKS = 5688492712607;

/**
 * ⏳ Customer On Hold — job is paused (any reason: customer, partner, ops).
 * NOTE: There is also a separate "Partner On Hold" status in Zendesk, but it
 * is reserved for partner-management tickets (onboarding/relationship), NOT
 * for paused jobs. Always use this one for job on_hold regardless of origin.
 */
export const ZD_STATUS_ON_HOLD = 5679178036127;

/** 💷 Awaiting Payment — work done, waiting for the customer to pay.
 *  PENDING category on purpose (dono, 18/08/2026): a automation "Close
 *  ticket 1 day after solved" fecha e arquiva qualquer ticket solved em 24h,
 *  e ticket arquivado some de toda view — pending mantém o ticket vivo na
 *  fila "💷 Awaiting Payment" até o pagamento cair de verdade. */
export const ZD_STATUS_AWAITING_PAYMENT = 6165486711711;

/** Completed — job finished successfully. Solved category (auto-closes the ticket).
 *  Uses the built-in "Solved" custom status (always enabled on every form);
 *  the previous custom "Completed" id (5688725804959) wasn't enabled on the
 *  ticket forms in production and 422'd every transition. */
export const ZD_STATUS_COMPLETED = 5679178036383;

/** Cancelled — job was cancelled. Solved category (auto-closes the ticket). */
/** ❌ Cancelled também está desativado no Zendesk (23/10/2026): cancelado vai para Solved. */
export const ZD_STATUS_CANCELLED = 5679178036383;

/** 💳 Deposit Pending: cotação aceita, job esperando a entrada (criado 23/10/2026). Categoria pending. */
export const ZD_STATUS_DEPOSIT_PENDING = Number(process.env.ZENDESK_STATUS_DEPOSIT_PENDING_ID?.trim() || "6472739656351");

/** ⚠️ Payment Failed: cartão recusado ou pedindo confirmação do banco (criado 23/10/2026). Categoria open. */
export const ZD_STATUS_PAYMENT_FAILED = Number(process.env.ZENDESK_STATUS_PAYMENT_FAILED_ID?.trim() || "6472739663647");

/**
 * 🔎 No Bids: 24h em Bidding sem lance de parceiro (criado 23/10/2026). Categoria open,
 * entra na view ⚡ Action Required pelo status. Antes disso o Bidding fica fora da fila.
 */
export const ZD_STATUS_NO_BIDS = Number(process.env.ZENDESK_STATUS_NO_BIDS_ID?.trim() || "6473488771487");

/** 🟣 Finance: fila manual do financeiro. */
export const ZD_STATUS_FINANCE = 5826336578463;

/** 🚨 Complaint — reclamação aberta (macro "Move to Complaint", que também põe a
 *  tag `in_complaint` e o formulário de reclamação). O OS não grava este status;
 *  só lê, para não pedir feedback de job que teve reclamação (14/10/2026). */
export const ZD_STATUS_COMPLAINT = Number(process.env.ZENDESK_STATUS_COMPLAINT_ID?.trim() || "5739880624543");

// ─── WhatsApp (Harvey) ───────────────────────────────────────────────────────

/** 💬 In Conversation (antigo 🟩 WhatsApp). Aposentado em 15/10/2026: tudo entra New/Open
 *  e a equipe classifica (Lead, quote, job, complaint). Fica aqui só para reconhecer
 *  tickets antigos que ainda estejam nele; nada novo deve receber este status. */
export const ZD_STATUS_WHATSAPP = 5799929141919;

/** 🟢 Partner — conversa de parceiro (grupo Partners), fora do Action Required. */
export const ZD_STATUS_PARTNER = 5722749157407;

/**
 * Funil de lead (dono, 12/10/2026): status que vivem só no Zendesk, para enxergar a
 * etapa de cada oportunidade. O OS não sincroniza nenhum deles; só o Harvey grava
 * To Call e Needs Quote ao passar a conversa para a equipe.
 */
export const ZD_STATUS_LEAD = Number(process.env.ZENDESK_STATUS_LEAD_ID?.trim() || "6417913706527");
export const ZD_STATUS_TO_CALL = Number(process.env.ZENDESK_STATUS_TO_CALL_ID?.trim() || "6417870637599");
export const ZD_STATUS_NEEDS_QUOTE = Number(process.env.ZENDESK_STATUS_NEEDS_QUOTE_ID?.trim() || "6417917628703");
/** 🆕 New e 🟡 Open: o ticket ainda não entrou em processo nenhum. */
export const ZD_STATUS_NEW = 5679191543071;
export const ZD_STATUS_OPEN = 5679178035743;

// ─── Backwards-compatible aliases ────────────────────────────────────────────
// Kept so existing imports don't break during the migration. New code should
// use the lifecycle-named constants above.

/** @deprecated Use ZD_STATUS_AWAITING_APPROVAL */
export const ZENDESK_STATUS_QUOTE_SENT = ZD_STATUS_AWAITING_APPROVAL;

/** @deprecated Use ZD_STATUS_SCHEDULED */
export const ZENDESK_STATUS_JOB_CREATED = ZD_STATUS_SCHEDULED;

/** @deprecated Use ZD_STATUS_ON_HOLD */
export const ZENDESK_STATUS_JOB_ON_HOLD = ZD_STATUS_ON_HOLD;

// ─── Base-status category for each custom status ────────────────────────────
// Zendesk rejects `PUT /tickets/X { custom_status_id }` with
// "Custom status is invalid" when the new custom_status_id belongs to a
// different category than the ticket's current base `status`. Setting both
// `status` (open / pending / hold / solved / closed) AND `custom_status_id`
// together always works — so the updateTicket helper looks up the category
// here whenever a custom_status_id is supplied.

export type ZendeskBaseStatus = "open" | "pending" | "hold" | "solved" | "closed";

const STATUS_CATEGORY: Record<number, ZendeskBaseStatus> = {
  [ZD_STATUS_QUOTE_READY]:       "open",
  [ZD_STATUS_BIDDING]:           "open",
  [ZD_STATUS_AWAITING_APPROVAL]: "open",
  [ZD_STATUS_UNASSIGNED]:        "open",
  [ZD_STATUS_AUTO_ASSIGNING]:    "open",
  [ZD_STATUS_SCHEDULED]:         "open",
  [ZD_STATUS_IN_PROGRESS]:       "open",
  [ZD_STATUS_FINAL_CHECKS]:      "open",
  [ZD_STATUS_ON_HOLD]:           "pending",
  [ZD_STATUS_AWAITING_PAYMENT]:  "pending",
  [ZD_STATUS_DEPOSIT_PENDING]:   "pending",
  [ZD_STATUS_PAYMENT_FAILED]:    "open",
  [ZD_STATUS_NO_BIDS]:           "open",
  [ZD_STATUS_COMPLAINT]:         "open",
  [ZD_STATUS_COMPLETED]:         "solved",
};

/** Returns the Zendesk base-status (`open`/`pending`/`solved`/etc.) for a
 *  known custom_status_id, or null when the id isn't in the lifecycle map
 *  (caller can fall back to whichever default they prefer). */
export function baseStatusForCustomStatusId(
  customStatusId: number | null | undefined,
): ZendeskBaseStatus | null {
  if (customStatusId == null) return null;
  return STATUS_CATEGORY[customStatusId] ?? null;
}

/**
 * Tag da fila 🚨 Needs Attention (reclamação e operação, do papel de operação, não de uma
 * pessoa: dono, 16/10/2026). Era "com_leo"; a view e o gatilho do funil aceitam as duas
 * durante a troca, e `TAGS_NEEDS_ATTENTION` lê as duas.
 */
export const TAG_NEEDS_ATTENTION = "ops_attention";
/** Tags que ainda contam como Needs Attention (a antiga até os tickets abertos migrarem). */
export const TAGS_NEEDS_ATTENTION = [TAG_NEEDS_ATTENTION, "com_leo"] as const;
