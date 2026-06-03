/**
 * OS → Zendesk: on-hold reason id, complaint description, partner solution.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getZendeskTicketId,
  isZendeskConfigured,
  setTicketCustomField,
  ZENDESK_COMPLAINT_DESCRIPTION_FIELD_ID,
  ZENDESK_COMPLAINT_SOLUTION_FIELD_ID,
  ZENDESK_ON_HOLD_REASON_FIELD_ID,
} from "@/lib/zendesk";
import { partnerOnHoldComplaintReasonText, partnerOnHoldSolutionText } from "@/lib/job-on-hold-reasons";

export interface ZendeskOnHoldFieldsSyncResult {
  ok: boolean;
  ticketId?: string;
  syncedFields: string[];
  skipped?: string;
  errors?: string[];
}

export async function syncJobZendeskOnHoldFields(
  jobId: string,
  client?: SupabaseClient,
): Promise<ZendeskOnHoldFieldsSyncResult> {
  const supabase = client ?? createServiceClient();
  const syncedFields: string[] = [];
  const errors: string[] = [];

  if (!isZendeskConfigured()) {
    return { ok: true, syncedFields, skipped: "zendesk_not_configured" };
  }

  const { data: job, error } = await supabase
    .from("jobs")
    .select(
      "id, external_source, external_ref, status, on_hold_reason_preset_id, on_hold_complaint_description, on_hold_reason, on_hold_submission",
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error || !job) {
    return { ok: false, syncedFields, errors: [error?.message ?? "Job not found"] };
  }

  const ticketId = getZendeskTicketId(job);
  if (!ticketId) {
    return { ok: true, syncedFields, skipped: "not_zendesk_linked" };
  }

  const presetId = (job.on_hold_reason_preset_id as string | null)?.trim() || null;
  const complaintText = partnerOnHoldComplaintReasonText(job as Parameters<typeof partnerOnHoldComplaintReasonText>[0]);
  const solutionText = partnerOnHoldSolutionText(job as Parameters<typeof partnerOnHoldSolutionText>[0]);

  if (ZENDESK_ON_HOLD_REASON_FIELD_ID > 0) {
    const value = job.status === "on_hold" ? presetId : null;
    const r = await setTicketCustomField({
      ticketId,
      fieldId: ZENDESK_ON_HOLD_REASON_FIELD_ID,
      value,
    });
    if (r.ok) syncedFields.push("on_hold_reason_id");
    else if (r.error) errors.push(`on_hold_reason_id: ${r.error}`);
  }

  if (ZENDESK_COMPLAINT_DESCRIPTION_FIELD_ID > 0) {
    const value = job.status === "on_hold" ? complaintText : null;
    const r = await setTicketCustomField({
      ticketId,
      fieldId: ZENDESK_COMPLAINT_DESCRIPTION_FIELD_ID,
      value,
    });
    if (r.ok) syncedFields.push("complaint_description");
    else if (r.error) errors.push(`complaint_description: ${r.error}`);
  }

  if (ZENDESK_COMPLAINT_SOLUTION_FIELD_ID > 0) {
    const r = await setTicketCustomField({
      ticketId,
      fieldId: ZENDESK_COMPLAINT_SOLUTION_FIELD_ID,
      value: solutionText,
    });
    if (r.ok) syncedFields.push("complaint_solution");
    else if (r.error) errors.push(`complaint_solution: ${r.error}`);
  }

  return { ok: errors.length === 0, ticketId, syncedFields, errors: errors.length ? errors : undefined };
}
