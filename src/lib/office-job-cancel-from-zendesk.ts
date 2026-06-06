/**
 * Zendesk → OS: cancel a job when an agent marks the ticket cancelled.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import {
  buildOfficeCancellationReasonText,
  officeCancellationNotesRequired,
  parseOfficeCancellationReasonId,
} from "@/lib/job-office-cancellation";
import { resolveOfficeJobCancellationPresets } from "@/lib/frontend-setup";
import { getCompanySettings } from "@/services/company";
import {
  patchOfficeCancelLostSnapshot,
  patchOfficeCancelZeroJobEconomics,
} from "@/lib/job-cancel-economics";
import { clearAutoAssignQueuePatch } from "@/lib/job-partner-assign";
import { runOfficeCancelAutoAssignCleanup } from "@/lib/office-cancel-auto-assign-cleanup";
import { statusChangeOfficeTimerPatch } from "@/lib/office-job-timer";
import { statusChangePartnerTimerPatch } from "@/lib/partner-live-timer";
import type { Job } from "@/types/database";
import { cancelOpenInvoicesForJobCancellation } from "@/services/invoices";
import { cancelOpenSelfBillsForJobCancellation } from "@/services/self-bills";
import { notifyPartnerJobZendesk } from "@/lib/notify-partner-job-zendesk-server";
import { syncJobZendeskStatus } from "@/lib/zendesk-status-sync";
import { syncJobZendeskCancellationFields } from "@/lib/zendesk-job-cancellation-sync";
import { prepareJobRowForUpdate } from "@/lib/job-schema-compat";

const NON_CANCELLABLE = new Set(["cancelled", "deleted"]);

export type ZendeskCancelJobInput = {
  ticketId: string;
  cancellationReasonId: string;
  cancellationNotes?: string | null;
  cancelledByAgent?: string | null;
  cancelledAt?: string | null;
};

export type ZendeskCancelJobResult =
  | { ok: true; status: 201 | 200; action: "cancelled" | "existing"; id: string; reference: string }
  | { ok: false; status: 400 | 404 | 500; error: string };

export async function cancelJobFromZendeskWebhook(
  input: ZendeskCancelJobInput,
  client?: SupabaseClient,
): Promise<ZendeskCancelJobResult> {
  const ticketId = input.ticketId.trim();
  const presetId = parseOfficeCancellationReasonId(input.cancellationReasonId);
  if (!presetId) {
    return { ok: false, status: 400, error: "Invalid cancellation_reason_id." };
  }

  const notes = input.cancellationNotes?.trim() || "";
  if (officeCancellationNotesRequired(presetId) && !notes) {
    return {
      ok: false,
      status: 400,
      error: "cancellation_notes is required when reason is other.",
    };
  }

  const companySettings = await getCompanySettings().catch(() => null);
  const presets = resolveOfficeJobCancellationPresets(companySettings?.frontend_setup ?? null);
  const reasonText = buildOfficeCancellationReasonText(presetId, notes, presets);

  const supabase = client ?? createServiceClient();

  const { data: jobRow, error: jobErr } = await supabase
    .from("jobs")
    .select(
      "id, reference, status, partner_id, invoice_id, self_bill_id, client_price, extras_amount, partner_cost, partner_extras_amount, materials_cost, partner_agreed_value, scheduled_date, scheduled_start_at, scheduled_end_at, partner_timer_started_at, partner_timer_ended_at, office_timer_started_at, office_timer_ended_at",
    )
    .eq("external_source", "zendesk")
    .eq("external_ref", ticketId)
    .maybeSingle();

  if (jobErr) {
    console.error("[zendesk-cancel-webhook] job lookup failed:", jobErr);
    return { ok: false, status: 500, error: "Lookup failed." };
  }
  if (!jobRow) {
    return { ok: false, status: 404, error: "No job linked to this ticket." };
  }

  const job = jobRow as {
    id: string;
    reference: string;
    status: string;
    partner_id: string | null;
    invoice_id: string | null;
    self_bill_id: string | null;
    client_price: number;
    extras_amount: number | null;
    partner_cost: number;
    partner_extras_amount: number | null;
    materials_cost: number;
    partner_agreed_value: number | null;
    scheduled_date: string | null;
    scheduled_start_at: string | null;
    scheduled_end_at: string | null;
  };

  if (job.status === "cancelled") {
    return {
      ok: true,
      status: 200,
      action: "existing",
      id: job.id,
      reference: job.reference,
    };
  }

  if (NON_CANCELLABLE.has(job.status)) {
    return {
      ok: false,
      status: 400,
      error: `Job cannot be cancelled from status ${job.status}.`,
    };
  }

  const now = input.cancelledAt?.trim() || new Date().toISOString();
  const jobForPatch = job as Pick<
    Job,
    | "status"
    | "client_price"
    | "extras_amount"
    | "partner_cost"
    | "partner_timer_started_at"
    | "partner_timer_ended_at"
    | "timer_elapsed_seconds"
    | "timer_last_started_at"
    | "timer_is_running"
  >;
  const patch = {
    ...patchOfficeCancelZeroJobEconomics(),
    ...patchOfficeCancelLostSnapshot(jobForPatch),
    ...clearAutoAssignQueuePatch(),
    status: "cancelled" as const,
    cancellation_reason: reasonText,
    cancelled_at: now,
    cancelled_by: null,
    ...statusChangePartnerTimerPatch(jobForPatch, "cancelled"),
    ...statusChangeOfficeTimerPatch(jobForPatch, "cancelled"),
  };

  const { error: upErr } = await supabase
    .from("jobs")
    .update(prepareJobRowForUpdate(patch))
    .eq("id", job.id);

  if (upErr) {
    console.error("[zendesk-cancel-webhook] update failed:", upErr);
    return { ok: false, status: 500, error: "Failed to cancel job." };
  }

  await runOfficeCancelAutoAssignCleanup(supabase, job.id).catch((e) =>
    console.error("[zendesk-cancel-webhook] auto-assign cleanup:", e),
  );

  await Promise.all([
    cancelOpenInvoicesForJobCancellation(
      {
        jobReference: job.reference,
        cancellationReason: reasonText,
        primaryInvoiceId: job.invoice_id,
      },
      supabase,
    ).catch((e) => console.error("[zendesk-cancel-webhook] invoice cancel:", e)),
    cancelOpenSelfBillsForJobCancellation(
      {
        jobReference: job.reference,
        primarySelfBillId: job.self_bill_id,
      },
      supabase,
    ).catch((e) => console.error("[zendesk-cancel-webhook] self-bill cancel:", e)),
  ]);

  await supabase.from("audit_logs").insert({
    entity_type: "job",
    entity_id: job.id,
    entity_ref: job.reference,
    action: "status_changed",
    field_name: "status",
    old_value: job.status,
    new_value: "cancelled",
    metadata: {
      source: "zendesk_cancellation_webhook",
      ticket_id: ticketId,
      cancellation_reason_id: presetId,
      cancelled_by_agent: input.cancelledByAgent ?? null,
    },
  }).then(() => {}, (e) => console.error("[zendesk-cancel-webhook] audit failed:", e));

  if (job.partner_id?.trim()) {
    void notifyPartnerJobZendesk(supabase, job.id, {
      kind: "cancelled",
      reason: reasonText,
      newStatusLabel: "Cancelled",
      skipPush: true,
      actorUserId: null,
    }).catch((err) => console.error("[zendesk-cancel-webhook] partner notify:", err));
  }

  void Promise.all([
    syncJobZendeskStatus(job.id, supabase),
    syncJobZendeskCancellationFields(job.id, {
      presetId,
      notes: notes || null,
      client: supabase,
      setup: companySettings?.frontend_setup ?? null,
    }),
  ]).catch((err) => console.error("[zendesk-cancel-webhook] zendesk sync:", err));

  return {
    ok: true,
    status: 201,
    action: "cancelled",
    id: job.id,
    reference: job.reference,
  };
}
