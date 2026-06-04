import {
  OFFICE_JOB_CANCELLATION_REASONS,
  type OfficeJobCancellationReasonId,
} from "@/lib/job-office-cancellation";

/** Zendesk dropdown option prefix — unique across all custom fields. */
export const ZENDESK_CANCEL_REASON_PREFIX = "cancel_";

const ALLOWED_IDS = new Set<string>(
  OFFICE_JOB_CANCELLATION_REASONS.map((r) => r.id),
);

export function isOfficeJobCancellationReasonId(id: string): id is OfficeJobCancellationReasonId {
  return ALLOWED_IDS.has(id.trim());
}

/** OS id → Zendesk tagger value (e.g. `client_requested` → `cancel_client_requested`). */
export function officeCancelIdToZendeskTag(osId: string): string {
  const id = osId.trim();
  if (!id) return "";
  if (id.startsWith(ZENDESK_CANCEL_REASON_PREFIX)) return id;
  return `${ZENDESK_CANCEL_REASON_PREFIX}${id}`;
}

/**
 * Zendesk value → bare OS id. Accepts `cancel_client_requested` or legacy bare `client_requested`.
 */
export function zendeskTagToOfficeCancelId(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  let id = v;
  if (id.startsWith(ZENDESK_CANCEL_REASON_PREFIX)) {
    id = id.slice(ZENDESK_CANCEL_REASON_PREFIX.length);
  }
  return isOfficeJobCancellationReasonId(id) ? id : null;
}
