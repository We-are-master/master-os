/**
 * OS → Zendesk: cancellation reason tag + notes on the linked ticket.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import type { FrontendSetup } from "@/lib/frontend-setup";
import { getZendeskTicketId, isZendeskConfigured, setTicketCustomFields } from "@/lib/zendesk";
import { resolveZendeskCancellationFieldIds } from "@/lib/zendesk-field-ids";
import { officeCancelIdToZendeskTag } from "@/lib/zendesk-cancellation-tags";

export interface ZendeskCancellationFieldsSyncResult {
  ok: boolean;
  ticketId?: string;
  syncedFields: string[];
  skipped?: string;
  errors?: string[];
}

async function loadFrontendSetup(client: SupabaseClient): Promise<FrontendSetup | null> {
  const { data } = await client
    .from("company_settings")
    .select("frontend_setup")
    .limit(1)
    .maybeSingle();
  return (data?.frontend_setup ?? null) as FrontendSetup | null;
}

export async function syncJobZendeskCancellationFields(
  jobId: string,
  opts?: {
    /** Bare OS reason id (e.g. client_requested). Required when job row has no preset stored. */
    presetId?: string | null;
    /** Free-text notes (required in OS when preset is other). */
    notes?: string | null;
    client?: SupabaseClient;
    setup?: FrontendSetup | null;
  },
): Promise<ZendeskCancellationFieldsSyncResult> {
  const supabase = opts?.client ?? createServiceClient();
  const syncedFields: string[] = [];
  const errors: string[] = [];

  if (!isZendeskConfigured()) {
    return { ok: true, syncedFields, skipped: "zendesk_not_configured" };
  }

  const resolvedSetup = opts?.setup ?? (await loadFrontendSetup(supabase));
  const fieldIds = resolveZendeskCancellationFieldIds(resolvedSetup);

  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, external_source, external_ref, status, cancellation_reason")
    .eq("id", jobId)
    .maybeSingle();

  if (error || !job) {
    return { ok: false, syncedFields, errors: [error?.message ?? "Job not found"] };
  }

  const ticketId = getZendeskTicketId(job);
  if (!ticketId) {
    return { ok: true, syncedFields, skipped: "not_zendesk_linked" };
  }

  const presetId = opts?.presetId?.trim() || null;
  const notes = opts?.notes?.trim() || null;

  const fields: Array<{ fieldId: number; value: string | null }> = [];
  const isCancelled = job.status === "cancelled";

  if (fieldIds.cancellationReasonFieldId > 0) {
    const value =
      isCancelled && presetId ? officeCancelIdToZendeskTag(presetId) : isCancelled ? null : null;
    if (isCancelled && presetId) {
      fields.push({ fieldId: fieldIds.cancellationReasonFieldId, value });
    } else if (!isCancelled) {
      fields.push({ fieldId: fieldIds.cancellationReasonFieldId, value: null });
    }
  }

  if (fieldIds.cancellationNotesFieldId > 0) {
    fields.push({
      fieldId: fieldIds.cancellationNotesFieldId,
      value: isCancelled ? notes : null,
    });
  }

  if (fields.length === 0) {
    return { ok: true, ticketId, syncedFields, skipped: "no_cancellation_fields_configured" };
  }

  const r = await setTicketCustomFields({ ticketId, fields });
  if (r.ok) {
    for (const f of fields) {
      if (f.fieldId === fieldIds.cancellationReasonFieldId) syncedFields.push("cancellation_reason");
      if (f.fieldId === fieldIds.cancellationNotesFieldId) syncedFields.push("cancellation_notes");
    }
  } else if (r.error) {
    errors.push(r.error);
  }

  console.log("[zendesk-job-cancellation-sync]", {
    jobId,
    ticketId,
    presetId,
    syncedFields,
    errors: errors.length ? errors : undefined,
  });

  return { ok: errors.length === 0, ticketId, syncedFields, errors: errors.length ? errors : undefined };
}
