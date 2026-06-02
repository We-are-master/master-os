import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyPartnerJobZendesk } from "@/lib/notify-partner-job-zendesk-server";
import { syncJobZendeskStatus } from "@/lib/zendesk-status-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Statuses that are terminal / can't be paused — putting them on hold is a no-op. */
const NON_HOLDABLE = new Set(["completed", "cancelled", "deleted", "on_hold"]);

const DEFAULT_REASON = "Customer complaint (raised via Zendesk).";

/**
 * POST /api/webhooks/desk/job-on-hold
 *
 * Inbound webhook from Zendesk. Triggered by a macro / automation when a
 * complaint comes in and the job must be paused. Puts the linked job On Hold:
 * snapshots its current schedule + status (so it can be resumed later from the
 * office), records the hold reason, then notifies the assigned partner and
 * syncs the ticket's custom status to "Customer On Hold".
 *
 * Auth: header `x-api-key` must match env `ZENDESK_WEBHOOK_API_KEY`
 * (or legacy `ZOHO_DESK_WEBHOOK_API_KEY`) — same secret as the other desk
 * webhooks.
 *
 * Expected JSON body:
 *   {
 *     ticket_id: string (required — the Zendesk ticket linked to the job)
 *     reason:    string (optional — shown to the office on resume; defaults
 *                        to a generic "Customer complaint" line)
 *   }
 *
 * Idempotent: a job already On Hold returns ok:true with action "already_on_hold".
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
  const reason = str(body.reason) || DEFAULT_REASON;

  const supabase = createServiceClient();

  // ─── Resolve the job from the Zendesk ticket ──────────────────────
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

  // ─── Idempotency / guard rails ────────────────────────────────────
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

  // ─── Put on hold (mirrors the office "Put on hold" action) ────────
  // Snapshot the current schedule + status so the office can resume the
  // job later from where it was (see migration 137_jobs_on_hold.sql).
  const { error: upErr } = await supabase
    .from("jobs")
    .update({
      status: "on_hold",
      on_hold_previous_status: job.status,
      on_hold_at: new Date().toISOString(),
      on_hold_reason: reason,
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

  // ─── Audit trail ──────────────────────────────────────────────────
  // System actor (created_by null) — this came from the Zendesk macro, not
  // a logged-in office user.
  await supabase.from("audit_logs").insert([
    {
      entity_type: "job",
      entity_id: job.id,
      entity_ref: job.reference,
      action: "status_changed",
      field_name: "status",
      old_value: job.status,
      new_value: "on_hold",
      metadata: { source: "zendesk_on_hold_webhook", ticket_id: ticketId },
    },
    {
      entity_type: "job",
      entity_id: job.id,
      entity_ref: job.reference,
      action: "updated",
      field_name: "on_hold_reason",
      new_value: reason,
      metadata: { source: "zendesk_on_hold_webhook", ticket_id: ticketId },
    },
  ]).then(() => {}, (e) => console.error("[webhook/desk/job-on-hold] audit insert failed:", e));

  // ─── Notify the assigned partner (push) + sync the ticket status ──
  // notifyPartnerJobZendesk maps on_hold → "Customer On Hold" custom status
  // and pushes the assigned partner. Best-effort: a notification failure must
  // not fail the webhook (the job is already on hold). If the job has no
  // partner / isn't fully Zendesk-linked, we still ensure the ticket status
  // is synced directly.
  const notify = await notifyPartnerJobZendesk(supabase, job.id, {
    kind: "on_hold",
    reason,
    newStatusLabel: "On Hold",
    actorUserId: null,
  }).catch((err) => {
    console.error("[webhook/desk/job-on-hold] partner notify threw:", err);
    return null;
  });

  void syncJobZendeskStatus(job.id, supabase).then(
    (r) => {
      if (!r.ok) console.error("[webhook/desk/job-on-hold] status sync failed:", r.error ?? r.skip);
    },
    (err) => console.error("[webhook/desk/job-on-hold] status sync threw:", err),
  );

  return NextResponse.json({
    ok: true,
    action: "put_on_hold",
    jobId: job.id,
    reference: job.reference,
    previousStatus: job.status,
    notify: notify?.body ?? null,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────

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
