import {
  OFFICE_JOB_CANCELLATION_REASONS,
  type OfficeJobCancellationReasonId,
} from "@/lib/job-office-cancellation";
import { fromZendeskTag, toZendeskTag } from "@/lib/zendesk-reason-tags";

/** @deprecated Use `ZENDESK_REASON_TAG_PREFIX.cancel` */
export const ZENDESK_CANCEL_REASON_PREFIX = "cancel_";

const ALLOWED_IDS = new Set<string>(
  OFFICE_JOB_CANCELLATION_REASONS.map((r) => r.id),
);

export function isOfficeJobCancellationReasonId(id: string): id is OfficeJobCancellationReasonId {
  return ALLOWED_IDS.has(id.trim());
}

export function officeCancelIdToZendeskTag(osId: string): string {
  return toZendeskTag(osId, "cancel");
}

export function zendeskTagToOfficeCancelId(raw: string): string | null {
  const id = fromZendeskTag(raw, "cancel");
  return id && isOfficeJobCancellationReasonId(id) ? id : null;
}
