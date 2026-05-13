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

/** 🟠 Ready to Quote — ticket has all info; quote is being prepared. Initial state after "Move to Quote" macro. */
export const ZD_STATUS_READY_TO_QUOTE = 5688507034015;

/** 🟤 Bidding — partners are being asked for prices. */
export const ZD_STATUS_BIDDING = 5688282472223;

/** 🟠 Awaiting Approval — quote PDF was sent to the customer; we're waiting for accept/reject. */
export const ZD_STATUS_AWAITING_APPROVAL = 5688280626847;

/** 🔴 Lost — quote was rejected or did not convert after follow-up. Solved category. */
export const ZD_STATUS_LOST = 5709657746335;

// ─── Job lifecycle ───────────────────────────────────────────────────────────

/** 🔴 Unassigned — job exists, no partner assigned yet (waiting on auto-assign or manual). */
export const ZD_STATUS_UNASSIGNED = 5688450872991;

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

/** Completed — job finished successfully. Solved category (auto-closes the ticket). */
export const ZD_STATUS_COMPLETED = 5688725804959;

/** Cancelled — job was cancelled. Solved category (auto-closes the ticket). */
export const ZD_STATUS_CANCELLED = 5697338496671;

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
  [ZD_STATUS_READY_TO_QUOTE]:    "open",
  [ZD_STATUS_BIDDING]:           "open",
  [ZD_STATUS_AWAITING_APPROVAL]: "open",
  [ZD_STATUS_UNASSIGNED]:        "open",
  [ZD_STATUS_SCHEDULED]:         "open",
  [ZD_STATUS_IN_PROGRESS]:       "open",
  [ZD_STATUS_FINAL_CHECKS]:      "open",
  [ZD_STATUS_ON_HOLD]:           "pending",
  [ZD_STATUS_COMPLETED]:         "solved",
  [ZD_STATUS_CANCELLED]:         "solved",
  [ZD_STATUS_LOST]:              "solved",
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
