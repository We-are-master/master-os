import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyPartnerJobZendesk } from "@/lib/notify-partner-job-zendesk-server";
import { syncJobZendeskStatus } from "@/lib/zendesk-status-sync";
import { syncJobZendeskOnHoldFields } from "@/lib/zendesk-job-on-hold-sync";
import {
  buildJobOnHoldReasonText,
  jobOnHoldReasonLabel,
  resolveJobOnHoldReasonIdFromLabel,
} from "@/lib/job-on-hold-reasons";
import { resolveJobOnHoldPresets } from "@/lib/frontend-setup";
import { getCompanySettings } from "@/services/company";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Statuses that are terminal / can't be paused — putting them on hold is a no-op. */
const NON_HOLDABLE = new Set(["completed", "cancelled", "deleted", "on_hold"]);

const DEFAULT_PRESET_ID = "complaint";
const DEFAULT_REASON = "Customer complaint (raised via Zendesk).";

/**
 * POST /api/webhooks/desk/job-on-hold
 *
 * Inbound webhook from Zendesk (Complaint macro + ticket form). Puts the linked
 * job On Hold, stores reason id + complaint description, notifies the partner,
 * and syncs Zendesk ticket status + custom fields.
 *
 * Auth: `x-api-key` = `ZENDESK_WEBHOOK_API_KEY` (or `ZOHO_DESK_WEBHOOK_API_KEY`).
 *
 * Expected JSON body:
 *   {
 *     ticket_id: string (required)
 *     on_hold_reason_id: string (optional — e.g. complaint; default complaint)
 *     description: string (optional — complaint detail for partner email + Zendesk)
 *     reason: string (legacy — label or free text; used when id omitted)
 *   }
 */
export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-api-key");
  const expected = (process.env.ZENDESK_WEBHOOK_API_KEY ?? process.env.ZOHO_DESK_WEBHOOK_API_KEY)?.trim();
  if (!expected) {
    console.error("[webhook/desk/job-on-hold] ZENDESK_WEBHOOK_API_KEY not configured");
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }
  if (!secretsMatch(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const ticketId = str(body.ticket_id);
  if (!ticketId) {
    return NextResponse.json({ error: "ticket_id is required." }, { status: 400 });
  }

  const companySettings = await getCompanySettings().catch(() => null);
  const presets = resolveJobOnHoldPresets(companySettings?.frontend_setup ?? null);

  const presetId =
    str(body.on_hold_reason_id)
    || str(body.on_hold_reason_preset_id)
    || resolveJobOnHoldReasonIdFromLabel(str(body.reason))
    || DEFAULT_PRESET_ID;

  const description = str(body.description) || str(body.complaint_description) || null;
  const reasonText =
    buildJobOnHoldReasonText(presetId, description, presets)
    || str(body.reason)
    || DEFAULT_REASON;

  const supabase = createServiceClient();

  const { data: jobRow, error: jobErr } = await supabase
    .from("jobs")
    .select("id, reference, status, scheduled_date, scheduled_start_at, scheduled_end_at, scheduled_finish_date")
    .eq("external_source", "zendesk")
    .eq("external_ref", ticketId)
    .maybeSingle();

  if (jobErr) {
    console.error("[webhook/desk/job-on-hold] job lookup failed:", jobErr);
    return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
  }
  if (!jobRow) {
    return NextResponse.json({ error: "No job linked to this ticket." }, { status: 404 });
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
    return NextResponse.json({
      ok: true,
      action: "already_on_hold",
      jobId: job.id,
      reference: job.reference,
    });
  }
  if (NON_HOLDABLE.has(job.status)) {
    return NextResponse.json({
      ok: true,
      action: "skipped_terminal_status",
      jobId: job.id,
      reference: job.reference,
      status: job.status,
    });
  }

  const { error: upErr } = await supabase
    .from("jobs")
    .update({
      status: "on_hold",
      on_hold_previous_status: job.status,
      on_hold_at: new Date().toISOString(),
      on_hold_reason_preset_id: presetId,
      on_hold_complaint_description: description,
      on_hold_reason: reasonText,
      on_hold_snapshot_scheduled_date: job.scheduled_date ?? null,
      on_hold_snapshot_scheduled_start_at: job.scheduled_start_at ?? null,
      on_hold_snapshot_scheduled_end_at: job.scheduled_end_at ?? null,
      on_hold_snapshot_scheduled_finish_date: job.scheduled_finish_date ?? null,
    })
    .eq("id", job.id);

  if (upErr) {
    console.error("[webhook/desk/job-on-hold] update failed:", upErr);
    return NextResponse.json({ error: "Failed to put job on hold." }, { status: 500 });
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
      metadata: { source: "zendesk_on_hold_webhook", ticket_id: ticketId, on_hold_reason_id: presetId },
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
  ]).then(() => {}, (e) => console.error("[webhook/desk/job-on-hold] audit insert failed:", e));

  const notify = await notifyPartnerJobZendesk(supabase, job.id, {
    kind: "on_hold",
    reason: description || reasonText,
    newStatusLabel: "On Hold",
    actorUserId: null,
  }).catch((err) => {
    console.error("[webhook/desk/job-on-hold] partner notify threw:", err);
    return null;
  });

  const [statusSync, fieldsSync] = await Promise.all([
    syncJobZendeskStatus(job.id, supabase).catch((err) => {
      console.error("[webhook/desk/job-on-hold] status sync threw:", err);
      return { ok: false, error: String(err) };
    }),
    syncJobZendeskOnHoldFields(job.id, supabase).catch((err) => {
      console.error("[webhook/desk/job-on-hold] on-hold fields sync threw:", err);
      return { ok: false, errors: [String(err)] };
    }),
  ]);

  return NextResponse.json({
    ok: true,
    action: "put_on_hold",
    jobId: job.id,
    reference: job.reference,
    previousStatus: job.status,
    onHoldReasonId: presetId,
    onHoldReasonLabel: jobOnHoldReasonLabel(presetId, presets),
    zendeskStatusSync: statusSync,
    zendeskFieldsSync: fieldsSync,
    notify: notify?.body ?? null,
  });
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
