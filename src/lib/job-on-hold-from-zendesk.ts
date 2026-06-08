/**
 * Zendesk → OS: put linked job on hold (webhook).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveJobOnHoldPresets, type FrontendSetup } from "@/lib/frontend-setup";
import {
  buildJobOnHoldReasonText,
  jobOnHoldComplaintDescriptionRequired,
  jobOnHoldReasonLabel,
  parseJobOnHoldReasonId,
  resolveJobOnHoldReasonIdFromLabel,
} from "@/lib/job-on-hold-reasons";
import { notifyPartnerJobZendesk } from "@/lib/notify-partner-job-zendesk-server";
import { syncJobZendeskStatus } from "@/lib/zendesk-status-sync";
import { syncJobZendeskOnHoldFields } from "@/lib/zendesk-job-on-hold-sync";

const NON_HOLDABLE = new Set(["completed", "cancelled", "deleted", "on_hold"]);
const DEFAULT_PRESET_ID = "complaint";
const DEFAULT_REASON = "Customer complaint (raised via Zendesk).";

export type ZendeskOnHoldJobInput = {
  ticketId: string;
  onHoldReasonId: string;
  onHoldNotes?: string | null;
  /** @deprecated alias for onHoldNotes */
  description?: string | null;
};

export type ZendeskOnHoldJobResult =
  | {
      ok: true;
      status: 200;
      action: "already_on_hold" | "put_on_hold" | "skipped_terminal_status";
      jobId: string;
      reference: string;
      previousStatus?: string;
      onHoldReasonId?: string;
      onHoldReasonLabel?: string;
      zendeskStatusSync?: unknown;
      zendeskFieldsSync?: unknown;
      notify?: unknown;
    }
  | { ok: false; status: 400 | 404 | 500; error: string };

export async function putJobOnHoldFromZendesk(
  input: ZendeskOnHoldJobInput,
  opts?: { setup?: FrontendSetup | null; client?: SupabaseClient },
): Promise<ZendeskOnHoldJobResult> {
  const ticketId = input.ticketId.trim();
  const notes = input.onHoldNotes?.trim() || input.description?.trim() || null;

  const presets = resolveJobOnHoldPresets(opts?.setup ?? null);
  const rawReason = input.onHoldReasonId.trim();

  let presetId: string;
  if (!rawReason) {
    presetId = DEFAULT_PRESET_ID;
  } else {
    const parsed =
      parseJobOnHoldReasonId(rawReason, presets)
      ?? resolveJobOnHoldReasonIdFromLabel(rawReason);
    if (!parsed) {
      return { ok: false, status: 400, error: "Invalid on_hold_reason_id." };
    }
    presetId = parsed;
  }

  if (jobOnHoldComplaintDescriptionRequired(presetId) && !notes) {
    return {
      ok: false,
      status: 400,
      error: "on_hold_notes is required when reason is complaint.",
    };
  }

  const reasonText = buildJobOnHoldReasonText(presetId, notes, presets) || DEFAULT_REASON;
  const supabase = opts?.client ?? createServiceClient();

  const { data: jobRow, error: jobErr } = await supabase
    .from("jobs")
    .select(
      "id, reference, status, scheduled_date, scheduled_start_at, scheduled_end_at, scheduled_finish_date",
    )
    .eq("external_source", "zendesk")
    .eq("external_ref", ticketId)
    .maybeSingle();

  if (jobErr) {
    console.error("[zendesk-on-hold-webhook] job lookup failed:", jobErr);
    return { ok: false, status: 500, error: "Lookup failed." };
  }
  if (!jobRow) {
    return { ok: false, status: 404, error: "No job linked to this ticket." };
  }

  const job = jobRow as {
    id: string;
    reference: string;
    status: string;
    scheduled_date: string | null;
    scheduled_start_at: string | null;
    scheduled_end_at: string | null;
    scheduled_finish_date: string | null;
  };

  if (job.status === "on_hold") {
    return {
      ok: true,
      status: 200,
      action: "already_on_hold",
      jobId: job.id,
      reference: job.reference,
    };
  }
  if (NON_HOLDABLE.has(job.status)) {
    return {
      ok: true,
      status: 200,
      action: "skipped_terminal_status",
      jobId: job.id,
      reference: job.reference,
      previousStatus: job.status,
    };
  }

  const { error: upErr } = await supabase
    .from("jobs")
    .update({
      status: "on_hold",
      on_hold_previous_status: job.status,
      on_hold_at: new Date().toISOString(),
      on_hold_reason_preset_id: presetId,
      on_hold_complaint_description: notes,
      on_hold_reason: reasonText,
      on_hold_snapshot_scheduled_date: job.scheduled_date ?? null,
      on_hold_snapshot_scheduled_start_at: job.scheduled_start_at ?? null,
      on_hold_snapshot_scheduled_end_at: job.scheduled_end_at ?? null,
      on_hold_snapshot_scheduled_finish_date: job.scheduled_finish_date ?? null,
    })
    .eq("id", job.id);

  if (upErr) {
    console.error("[zendesk-on-hold-webhook] update failed:", upErr);
    return { ok: false, status: 500, error: "Failed to put job on hold." };
  }

  await supabase.from("audit_logs").insert([
    {
      entity_type: "job",
      entity_id: job.id,
      entity_ref: job.reference,
      action: "status_changed",
      field_name: "status",
      old_value: job.status,
      new_value: "on_hold",
      metadata: {
        source: "zendesk_on_hold_webhook",
        ticket_id: ticketId,
        on_hold_reason_id: presetId,
      },
    },
    {
      entity_type: "job",
      entity_id: job.id,
      entity_ref: job.reference,
      action: "updated",
      field_name: "on_hold_reason",
      new_value: reasonText,
      metadata: { source: "zendesk_on_hold_webhook", ticket_id: ticketId },
    },
  ]).then(() => {}, (e) => console.error("[zendesk-on-hold-webhook] audit failed:", e));

  const notify = await notifyPartnerJobZendesk(supabase, job.id, {
    kind: "on_hold",
    reason: notes || reasonText,
    newStatusLabel: "On Hold",
    actorUserId: null,
  }).catch((err) => {
    console.error("[zendesk-on-hold-webhook] partner notify:", err);
    return null;
  });

  const [statusSync, fieldsSync] = await Promise.all([
    syncJobZendeskStatus(job.id, supabase),
    syncJobZendeskOnHoldFields(job.id, supabase, opts?.setup ?? null),
  ]);

  return {
    ok: true,
    status: 200,
    action: "put_on_hold",
    jobId: job.id,
    reference: job.reference,
    previousStatus: job.status,
    onHoldReasonId: presetId,
    onHoldReasonLabel: jobOnHoldReasonLabel(presetId, presets),
    zendeskStatusSync: statusSync,
    zendeskFieldsSync: fieldsSync,
    notify: notify?.body ?? null,
  };
}
