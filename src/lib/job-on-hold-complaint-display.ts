import type { SupabaseClient } from "@supabase/supabase-js";
import type { FrontendSetup } from "@/lib/frontend-setup";
import { partnerOnHoldComplaintReasonText } from "@/lib/job-on-hold-reasons";
import { createServiceClient } from "@/lib/supabase/service";
import { getTicketCustomFieldValue, getZendeskTicketId, isZendeskConfigured } from "@/lib/zendesk";
import { resolveZendeskComplaintFieldIds } from "@/lib/zendesk-field-ids";

export type JobOnHoldComplaintSource = {
  id: string;
  external_source?: string | null;
  external_ref?: string | null;
  on_hold_complaint_description?: string | null;
  on_hold_reason?: string | null;
  on_hold_reason_preset_id?: string | null;
};

/**
 * Partner-facing "what the customer reported" — OS complaint description first,
 * then Zendesk ticket Complaint Description custom field (with optional OS backfill).
 */
export async function resolvePartnerComplaintReportedText(
  job: JobOnHoldComplaintSource,
  options?: {
    setup?: FrontendSetup | null;
    client?: SupabaseClient;
    /** When true, copy Zendesk field into `jobs.on_hold_complaint_description` if empty. */
    backfillOs?: boolean;
  },
): Promise<string | null> {
  const fromOs = partnerOnHoldComplaintReasonText(job);
  if (fromOs) return fromOs;

  if (!isZendeskConfigured()) return null;
  const ticketId = getZendeskTicketId(job);
  if (!ticketId) return null;

  const fieldId = resolveZendeskComplaintFieldIds(options?.setup ?? null).complaintDescriptionFieldId;
  if (fieldId <= 0) return null;

  const fetched = await getTicketCustomFieldValue(ticketId, fieldId);
  if (!fetched.ok) return null;
  const text = fetched.value?.trim();
  if (!text) return null;

  if (options?.backfillOs !== false) {
    const supabase = options?.client ?? createServiceClient();
    await supabase
      .from("jobs")
      .update({ on_hold_complaint_description: text })
      .eq("id", job.id)
      .is("on_hold_complaint_description", null);
  }

  return text;
}
