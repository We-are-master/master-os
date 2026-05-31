import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSideConversation, replyToSideConversation } from "@/lib/zendesk";
import { createPartnerReportToken, createPartnerJobAcceptToken } from "@/lib/quote-response-token";
import { upsertShortLink } from "@/lib/short-links";
import { syncJobZendeskStatus } from "@/lib/zendesk-status-sync";
import { appBaseUrl } from "@/lib/app-base-url";
import { loadPartnerJobEmailNotes } from "@/lib/partner-job-email-notes";
import {
  buildPartnerJobConfirmationEmail,
  buildPartnerJobStatusUpdateEmail,
  buildJobRescheduledEmail,
  buildPartnerJobOnHoldEmail,
  buildPartnerJobConfirmationRequestEmail,
  type PartnerJobStatusKind,
} from "@/lib/emails/partner-job-confirmation";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

type NotifyKind = "assigned" | PartnerJobStatusKind;

interface NotifyBody {
  kind?: NotifyKind;          // default "assigned" for backwards compatibility
  reason?: string | null;     // e.g. cancellation reason / hold reason
  newStatusLabel?: string;    // human label e.g. "Cancelled", "On Hold"
  /** When kind = "rescheduled", these supply the side-by-side date comparison. */
  oldDateLine?: string;
  oldTimeLine?: string | null;
  newDateLine?: string;
  newTimeLine?: string | null;
  /** When true, skip the Expo push send — caller already triggered it via notifyAssignedPartnerAboutJob. */
  skipPush?: boolean;
}

/**
 * POST /api/jobs/[id]/notify-partner-zendesk
 *
 * Sends a push notification to the assigned partner AND opens / replies on
 * a Zendesk Side Conversation. Returns the status of both so the UI can
 * surface them together.
 *
 * Behaviour:
 *   - First call for a job → creates a new side conversation, stores its id
 *     on jobs.zendesk_side_conversation_id
 *   - Subsequent calls → reply on the existing thread
 *   - For cancelled / on_hold the email body includes the reason
 *
 * No-ops (returns ok:true with `skipped`) when:
 *   - job.external_source != 'zendesk' or no external_ref
 *   - job has no partner_id
 *   - partner has no email AND no push token (nothing to send)
 *
 * Always logs the attempt to job_zendesk_events.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: jobId } = await ctx.params;
  if (!jobId) return NextResponse.json({ error: "id required" }, { status: 400 });

  let body: NotifyBody = {};
  try { body = (await req.json()) as NotifyBody; } catch { /* empty body OK */ }
  const kind: NotifyKind = body.kind ?? "assigned";
  const reason = body.reason?.trim() || null;
  const newStatusLabel = body.newStatusLabel?.trim() || null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server not configured" }, { status: 503 });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: jobRow, error: jobErr } = await supabase
    .from("jobs")
    .select("id, reference, title, status, client_name, property_address, scheduled_date, catalog_service_id, scope, partner_id, external_source, external_ref, zendesk_side_conversation_id, job_type, hourly_partner_rate, partner_cost, cancellation_reason, on_hold_reason")
    .eq("id", jobId)
    .maybeSingle();

  if (jobErr || !jobRow) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  type JobRow = {
    id: string;
    reference: string;
    title: string | null;
    status: string;
    client_name: string | null;
    property_address: string | null;
    scheduled_date: string | null;
    catalog_service_id: string | null;
    scope: string | null;
    partner_id: string | null;
    external_source: string | null;
    external_ref: string | null;
    zendesk_side_conversation_id: string | null;
    job_type: "hourly" | "fixed" | null;
    hourly_partner_rate: number | null;
    partner_cost: number | null;
    cancellation_reason: string | null;
    on_hold_reason: string | null;
  };
  const job = jobRow as JobRow;

  const zendeskTicketId = job.external_source === "zendesk" ? job.external_ref : null;
  if (!job.partner_id) {
    return NextResponse.json({ ok: true, skipped: "no_partner" });
  }

  // Look up partner email + push token in one go
  const { data: partnerRow } = await supabase
    .from("partners")
    .select("id, contact_name, company_name, email, expo_push_token, auth_user_id, zendesk_user_id")
    .eq("id", job.partner_id)
    .maybeSingle();
  const partner = partnerRow as {
    id: string;
    contact_name: string | null;
    company_name: string | null;
    email: string | null;
    expo_push_token: string | null;
    auth_user_id: string | null;
    zendesk_user_id: string | null;
  } | null;

  if (!partner) {
    return NextResponse.json({ ok: true, skipped: "partner_not_found" });
  }

  // Customer phone is intentionally NOT looked up — partner emails carry
  // name + address only (privacy decision: customer phone stays with OS).

  const isHourly = job.job_type === "hourly";
  const priceDisplay = isHourly
    ? `£${Number(job.hourly_partner_rate ?? 0).toFixed(2)}/hr`
    : `£${Number(job.partner_cost ?? 0).toFixed(2)}`;
  const partnerFirstName = (partner.contact_name?.trim().split(/\s+/)[0])
    || (partner.company_name?.trim() ?? "Partner");
  // Partner-scoped web report link — shipped as the primary CTA in every
  // partner email (assigned/completed/etc) so the partner can submit the
  // report straight from their inbox without the app. The token binds
  // (jobId, partnerId), so reassigning the partner invalidates older links.
  const base = appBaseUrl();
  let reportUrl = `${base}/job/report?token=${encodeURIComponent(createPartnerReportToken(job.id, partner.id))}`;
  try {
    const r = await upsertShortLink({
      targetPath: `/job/report?token=${encodeURIComponent(createPartnerReportToken(job.id, partner.id))}`,
      kind:       "partner_report",
      entityRef:  `job:${job.id}:partner:${partner.id}`,
      createdBy:  auth.user.id,
    });
    reportUrl = `${base}${r.shortPath}`;
  } catch (err) {
    console.error("[notify-partner-zendesk] short link upsert failed, using long URL:", err);
  }

  // Resolve final reason / status label
  const effectiveReason = reason
    ?? (kind === "cancelled" ? job.cancellation_reason : null)
    ?? (kind === "on_hold" ? job.on_hold_reason : null);
  const effectiveStatusLabel = newStatusLabel ?? humanStatusLabel(job.status);

  const needsPartnerJobNotes = kind === "assigned" || kind === "confirmation_request" || kind === "booked";
  const partnerNotes = needsPartnerJobNotes
    ? await loadPartnerJobEmailNotes(supabase, {
        catalogServiceId: job.catalog_service_id,
        jobTitle: job.title,
        jobType: isHourly ? "hourly" : "fixed",
      })
    : null;

  // ─── Email build ──────────────────────────────────────────────────
  let email: { subject: string; html: string; text: string };
  if (kind === "assigned") {
    email = buildPartnerJobConfirmationEmail({
      partnerFirstName,
      jobReference: job.reference,
      jobTitle: job.title || "Maintenance job",
      clientName: job.client_name || "—",
      propertyAddress: job.property_address || "—",
      scheduledDate: job.scheduled_date,
      scope: job.scope || "(no scope provided)",
      jobType: isHourly ? "hourly" : "fixed",
      priceDisplay,
      partnerNotes,
      reportUrl,
    });
  } else if (kind === "rescheduled") {
    email = buildJobRescheduledEmail({
      recipientFirstName: partnerFirstName,
      jobReference: job.reference,
      jobTitle: job.title || "Maintenance job",
      propertyAddress: job.property_address || "—",
      oldDateLine: body.oldDateLine ?? "Previous schedule",
      oldTimeLine: body.oldTimeLine ?? null,
      newDateLine: body.newDateLine ?? "New schedule",
      newTimeLine: body.newTimeLine ?? null,
    });
  } else if (kind === "on_hold") {
    email = buildPartnerJobOnHoldEmail({
      partnerFirstName,
      jobReference:    job.reference,
      jobTitle:        job.title || "Maintenance job",
      propertyAddress: job.property_address || "—",
    });
  } else if (kind === "confirmation_request") {
    // Tokenised Accept link, shortened so the email shows /p/abc12 instead
    // of the raw token.
    const acceptToken = createPartnerJobAcceptToken(job.id, partner.id);
    let acceptUrl = `${base}/job/confirm?token=${encodeURIComponent(acceptToken)}`;
    try {
      const r = await upsertShortLink({
        targetPath: `/job/confirm?token=${encodeURIComponent(acceptToken)}`,
        kind:       "partner_accept",
        entityRef:  `job:${job.id}:partner:${partner.id}`,
        createdBy:  auth.user.id,
      });
      acceptUrl = `${base}${r.shortPath}`;
    } catch (err) {
      console.error("[notify-partner-zendesk] accept short link upsert failed:", err);
    }
    email = buildPartnerJobConfirmationRequestEmail({
      partnerFirstName,
      jobReference:    job.reference,
      jobTitle:        job.title || "Maintenance job",
      clientName:      job.client_name || "—",
      propertyAddress: job.property_address || "—",
      scheduledDate:   job.scheduled_date,
      scope:           job.scope || "(no scope provided)",
      priceDisplay,
      partnerNotes,
      acceptUrl,
    });
  } else if (kind === "booked") {
    // Same body as the existing "assigned" email (which IS the booked
    // template — variable name is legacy). Fired after the partner clicks
    // Accept on a confirmation_request OR after a bid is approved.
    email = buildPartnerJobConfirmationEmail({
      partnerFirstName,
      jobReference: job.reference,
      jobTitle: job.title || "Maintenance job",
      clientName: job.client_name || "—",
      propertyAddress: job.property_address || "—",
      scheduledDate: job.scheduled_date,
      scope: job.scope || "(no scope provided)",
      jobType: isHourly ? "hourly" : "fixed",
      priceDisplay,
      partnerNotes,
      reportUrl,
    });
  } else {
    email = buildPartnerJobStatusUpdateEmail({
      kind,
      partnerFirstName,
      jobReference: job.reference,
      jobTitle: job.title || "Maintenance job",
      clientName: job.client_name || "—",
      propertyAddress: job.property_address || "—",
      scope: job.scope || "(no scope provided)",
      newStatusLabel: effectiveStatusLabel,
      reason: effectiveReason,
      reportUrl,
    });
  }

  // ─── Push notification ────────────────────────────────────────────
  const pushResult = body.skipPush
    ? { ok: false, tokens_sent: 0, error: "skipped_by_caller" as const }
    : await sendExpoPushToPartner(supabase, partner, {
        title: pushTitleFor(kind, effectiveStatusLabel),
        body: `${job.reference} · ${job.title || "Job update"} · ${job.property_address ?? ""}`.slice(0, 250),
        data: { type: pushTypeFor(kind), jobId: job.id, jobReference: job.reference, status: job.status },
      });

  // ─── Partner email policy ─────────────────────────────────────────
  // Partners only receive two side-conv emails: job confirmation
  // (`assigned`) and job finished (`completed`). All other lifecycle
  // events still get the in-app push above, but we don't email them —
  // status updates were noisy and the office handles those manually.
  const PARTNER_EMAIL_KINDS = new Set<NotifyKind>(["assigned", "completed"]);
  const partnerEmailEnabled = PARTNER_EMAIL_KINDS.has(kind);

  // ─── Zendesk side conversation (only if we have the ticket) ──────
  let zendeskResult: {
    ok: boolean;
    side_conversation_id?: string | null;
    error?: string;
    skipped?: string;
  } = { ok: false, error: "skipped" };
  if (zendeskTicketId && partnerEmailEnabled) {
    if (!partner.email) {
      zendeskResult = { ok: false, error: "partner_has_no_email" };
    } else if (job.zendesk_side_conversation_id) {
      const r = await replyToSideConversation({
        ticketId: zendeskTicketId,
        sideConversationId: job.zendesk_side_conversation_id,
        htmlBody: email.html,
        bodyText: email.text,
      });
      zendeskResult = { ok: r.ok, side_conversation_id: job.zendesk_side_conversation_id, error: r.error };
    } else {
      const r = await createSideConversation({
        ticketId: zendeskTicketId,
        toEmail:  partner.email,
        toName:   partner.contact_name || partner.company_name || undefined,
        toUserId: partner.zendesk_user_id ?? undefined,
        subject:  email.subject,
        htmlBody: email.html,
        bodyText: email.text,
      });
      zendeskResult = { ok: r.ok, side_conversation_id: r.id ?? null, error: r.error };
      if (r.ok && r.id) {
        // Persist for future replies
        await supabase
          .from("jobs")
          .update({ zendesk_side_conversation_id: r.id })
          .eq("id", job.id);
      }
    }
  } else if (zendeskTicketId && !partnerEmailEnabled) {
    // Intentional policy skip — not an error (partner email only on assign + complete).
    zendeskResult = { ok: true, skipped: `kind_${kind}` };
  }

  // ─── Always sync custom_status_id on the main ticket ─────────────
  // Every notify call carries an implicit "the office did something
  // on this job — make sure the ticket reflects it". The central
  // syncJobZendeskStatus reads the current job.status and maps it to
  // the right Zendesk custom_status_id (Scheduled, In Progress,
  // Final Checks, Completed, Cancelled, …). Fire-and-forget so a
  // status sync failure can't block the partner notification.
  //
  // Previously only `on_hold` got this; everything else (job booked /
  // scheduled / completed / cancelled) relied on the DB trigger fire
  // on status change, which doesn't fire when the office runs notify
  // without changing the job's status (e.g. clicking "Send via
  // Zendesk" on an already-scheduled job).
  if (zendeskTicketId) {
    void syncJobZendeskStatus(job.id, supabase).then(
      (r) => {
        if (!r.ok) {
          console.error(
            "[notify-partner-zendesk] status sync failed for ticket",
            zendeskTicketId,
            ":",
            r.error ?? r.skip ?? "unknown",
          );
        } else {
          console.log(
            "[notify-partner-zendesk] status synced for ticket",
            zendeskTicketId,
            "→",
            r.customStatusId ?? "(skipped)",
            "job",
            job.reference,
          );
        }
      },
      (err) => console.error("[notify-partner-zendesk] status sync threw:", err),
    );
  }

  // ─── Log ──────────────────────────────────────────────────────────
  await supabase.from("job_zendesk_events").insert({
    job_id:             job.id,
    kind,
    status_at_event:    job.status,
    push_ok:            pushResult.ok,
    push_tokens_sent:   pushResult.tokens_sent,
    push_error:         pushResult.error ?? null,
    zendesk_ok:         zendeskResult.ok,
    zendesk_message_id: zendeskResult.side_conversation_id ?? null,
    zendesk_error:      zendeskResult.error ?? null,
    created_by:         auth.user.id,
  }).then(() => {}, (e) => console.error("[zendesk-event-log] insert failed:", e));

  return NextResponse.json({
    ok: true,
    kind,
    push: { ok: pushResult.ok, tokens_sent: pushResult.tokens_sent, error: pushResult.error ?? null },
    zendesk: zendeskTicketId
      ? {
          ok: zendeskResult.ok,
          side_conversation_id: zendeskResult.side_conversation_id ?? null,
          error: zendeskResult.error ?? null,
          skipped: zendeskResult.skipped ?? null,
        }
      : { ok: false, skipped: "not_a_zendesk_job" },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────

function pushTitleFor(kind: NotifyKind, statusLabel: string): string {
  switch (kind) {
    case "assigned":              return "New job assigned";
    case "cancelled":             return "Job cancelled";
    case "on_hold":               return "Job placed on hold";
    case "resumed":               return "Job resumed";
    case "completed":             return "Job completed";
    case "rescheduled":           return "Job rescheduled";
    case "status_changed":        return `Job status: ${statusLabel}`;
    case "confirmation_request":  return "Confirm this job";
    case "booked":                return "Job booked";
  }
}

function pushTypeFor(kind: NotifyKind): string {
  switch (kind) {
    case "assigned":              return "job_assigned";
    case "cancelled":             return "job_cancelled_by_office";
    case "on_hold":               return "job_on_hold";
    case "resumed":               return "job_resumed";
    case "completed":             return "job_completed";
    case "rescheduled":           return "job_rescheduled";
    case "status_changed":        return "job_status_changed";
    case "confirmation_request":  return "job_confirmation_request";
    case "booked":                return "job_booked";
  }
}

function humanStatusLabel(s: string): string {
  switch (s) {
    case "in_progress_phase1":
    case "in_progress_phase2":
    case "in_progress_phase3": return "In Progress";
    case "final_check":        return "Final Check";
    case "awaiting_payment":   return "Awaiting Payment";
    case "need_attention":     return "Needs Attention";
    case "on_hold":            return "On Hold";
    case "auto_assigning":     return "Assigning";
    default:                   return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

async function sendExpoPushToPartner(
  supabase: SupabaseClient,
  partner: { id: string; expo_push_token: string | null; auth_user_id: string | null },
  notification: { title: string; body: string; data: Record<string, unknown> },
): Promise<{ ok: boolean; tokens_sent: number; error: string | null }> {
  const tokens: string[] = [];
  if (partner.expo_push_token) tokens.push(partner.expo_push_token);

  if (!tokens.length && partner.auth_user_id) {
    const { data: user } = await supabase
      .from("users")
      .select("fcmToken")
      .eq("id", partner.auth_user_id)
      .not("fcmToken", "is", null)
      .maybeSingle();
    const fcm = (user as { fcmToken?: string | null } | null)?.fcmToken;
    if (fcm) tokens.push(fcm);
  }

  if (!tokens.length) return { ok: false, tokens_sent: 0, error: "no_push_token" };

  try {
    const messages = tokens.map((to) => ({
      to,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      sound: "default" as const,
    }));
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, tokens_sent: 0, error: `expo_${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true, tokens_sent: tokens.length, error: null };
  } catch (err) {
    return { ok: false, tokens_sent: 0, error: err instanceof Error ? err.message : "fetch_failed" };
  }
}
