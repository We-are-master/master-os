import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { matchPartnerIdsForWork } from "@/lib/partner-work-matching";
import { extractUkPostcode } from "@/lib/uk-postcode";
import { resolveDeskWebhookClientEmail } from "@/lib/desk-webhook-client-email";
import { createSideConversation, setTicketJobReference } from "@/lib/zendesk";
import {
  buildPartnerJobConfirmationEmail,
} from "@/lib/emails/partner-job-confirmation";
import { loadPartnerJobEmailNotes } from "@/lib/partner-job-email-notes";
import { dispatchAutoAssignJobInvites, sendPushToPartners } from "@/lib/auto-assign-job-invites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/webhooks/desk/job-created
 *
 * Inbound webhook from Zoho Desk. Creates a job in Master OS.
 *
 * assignment_mode:
 *   "auto"     → match active partners by service_type, set status = auto_assigning,
 *                push-notify matched partners
 *   "specific" → look up partner by partner_email, set status = scheduled
 *   omitted    → status = unassigned
 *
 * Expected JSON body:
 *   {
 *     ticket_id:        string (required — idempotency key)
 *     title:            string
 *     client_name:      string (required)
 *     client_email:     string (required)
 *     client_phone:     string
 *     property_address: string (required)
 *     service_type:     string (required)
 *     description:      string
 *     scope:            string
 *     client_price:     number
 *     partner_cost:     number
 *     scheduled_date:   string (YYYY-MM-DD)
 *     urgency:          string (Low | Medium | High | Urgent)
 *     assignment_mode:  "auto" | "specific"
 *     partner_email:    string (when assignment_mode = "specific")
 *   }
 */
export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-api-key");
  const expected = (process.env.ZENDESK_WEBHOOK_API_KEY ?? process.env.ZOHO_DESK_WEBHOOK_API_KEY)?.trim();
  if (!expected) {
    console.error("[webhook/desk/job] ZOHO_DESK_WEBHOOK_API_KEY not configured");
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

  const ticketId        = str(body.ticket_id);
  const title           = str(body.title);
  const clientName      = str(body.client_name);
  const clientEmail     = resolveDeskWebhookClientEmail(body.client_email);
  const clientPhone     = str(body.client_phone);
  const propertyAddress = str(body.property_address);
  const serviceType     = str(body.service_type);
  const description     = str(body.description);
  const scope           = str(body.scope);
  const clientPrice     = num(body.client_price);
  const partnerCost     = num(body.partner_cost);
  const scheduledDate   = str(body.scheduled_date);
  const urgency         = str(body.urgency);
  const assignmentMode  = str(body.assignment_mode).toLowerCase();
  const partnerEmail    = str(body.partner_email).toLowerCase();

  if (!ticketId) {
    return NextResponse.json({ error: "ticket_id is required." }, { status: 400 });
  }
  if (!scope) {
    return NextResponse.json({ error: "scope is required." }, { status: 400 });
  }
  if (!clientName || !propertyAddress || !serviceType) {
    return NextResponse.json(
      { error: "client_name, property_address and service_type are required." },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();

  // ─── Idempotency ────────────────────────────────────────────────────
  const { data: existing } = await supabase
    .from("jobs")
    .select("id, reference")
    .eq("external_source", "zendesk")
    .eq("external_ref", ticketId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      ok: true,
      jobId: (existing as { id: string }).id,
      reference: (existing as { reference: string }).reference,
      action: "already_exists",
    });
  }

  // ─── Resolve client ─────────────────────────────────────────────────
  let clientId: string | null = null;
  if (clientEmail) {
    const { data: clientRow } = await supabase
      .from("clients")
      .select("id")
      .eq("email", clientEmail)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (clientRow) {
      clientId = (clientRow as { id: string }).id;
    } else {
      const { data: newClient } = await supabase
        .from("clients")
        .insert({
          full_name: clientName,
          email: clientEmail,
          phone: clientPhone || null,
          address: propertyAddress,
          client_type: "business",
          source: "zendesk",
          status: "active",
        })
        .select("id")
        .single();
      if (newClient) clientId = (newClient as { id: string }).id;
    }
  }

  // ─── Resolve partner (specific mode) ────────────────────────────────
  let partnerId: string | null = null;
  let partnerName: string | null = null;

  if (assignmentMode === "specific" && partnerEmail) {
    const { data: p } = await supabase
      .from("partners")
      .select("id, company_name, contact_name")
      .eq("email", partnerEmail)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (p) {
      const pr = p as { id: string; company_name: string; contact_name: string };
      partnerId = pr.id;
      partnerName = pr.company_name?.trim() || pr.contact_name;
    }
  }

  // ─── Auto-assign: find matching partners ────────────────────────────
  let matchedPartnerIds: string[] = [];

  if (assignmentMode === "auto") {
    // Trade match + partner self-service prefs (excluded postcodes).
    matchedPartnerIds = await matchPartnerIdsForWork(supabase, {
      serviceType,
      postcode: extractUkPostcode(propertyAddress),
      kind: "job",
    });
  }

  // ─── Determine status ───────────────────────────────────────────────
  let status: string;
  if (assignmentMode === "auto" && matchedPartnerIds.length > 0) {
    status = "auto_assigning";
  } else if (assignmentMode === "specific" && partnerId) {
    status = "scheduled";
  } else {
    status = "unassigned";
  }

  // ─── Generate reference + insert ───────────────────────────────────
  const { data: refData, error: refErr } = await supabase.rpc("next_job_ref");
  if (refErr || !refData) {
    console.error("[webhook/desk/job] next_job_ref failed:", refErr);
    return NextResponse.json({ error: "Could not generate a job reference." }, { status: 500 });
  }

  const margin = clientPrice > 0 && partnerCost > 0
    ? Math.round(((clientPrice - partnerCost) / clientPrice) * 10000) / 100
    : 0;

  const jobRow: Record<string, unknown> = {
    reference: String(refData),
    title: title || serviceType,
    client_id: clientId,
    client_name: clientName,
    property_address: propertyAddress,
    status,
    partner_id: partnerId,
    partner_name: partnerName,
    client_price: clientPrice,
    partner_cost: partnerCost,
    materials_cost: 0,
    margin_percent: margin,
    scope,
    scheduled_date: scheduledDate || null,
    total_phases: 2,
    progress: 0,
    current_phase: 0,
    job_type: "fixed",
    finance_status: "unpaid",
    external_source: "zendesk",
    external_ref: ticketId,
  };

  if (assignmentMode === "auto" && matchedPartnerIds.length > 0) {
    jobRow.auto_assign_invited_partner_ids = matchedPartnerIds;
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("jobs")
    .insert(jobRow)
    .select("id, reference, status")
    .single();

  if (insertErr || !inserted) {
    console.error("[webhook/desk/job] insert failed:", insertErr);
    return NextResponse.json({ error: "Could not create the job." }, { status: 500 });
  }

  const jobId = (inserted as { id: string }).id;
  const jobRef = (inserted as { reference: string }).reference;

  // ─── Mirror job reference back into the Zendesk ticket field ────────
  // Best-effort, non-blocking — the field is informational for agents.
  void setTicketJobReference(ticketId, jobRef).then((r) => {
    if (!r.ok) console.error("[webhook/desk/job] setTicketJobReference failed:", r.error);
  });

  // ─── Push notifications ─────────────────────────────────────────────
  let pushSent = 0;

  if (assignmentMode === "auto" && matchedPartnerIds.length > 0) {
    void dispatchAutoAssignJobInvites({
      jobId,
      jobReference: jobRef,
      jobTitle: title || serviceType,
      clientName,
      propertyAddress,
      scope: scope || "(no scope provided)",
      scheduledDate: scheduledDate || null,
      partnerIds: matchedPartnerIds,
      zendeskTicketId: ticketId,
    })
      .then(({ pushSent: sent }) => {
        pushSent = sent;
      })
      .catch((err) => console.error("[webhook/desk/job] auto invites failed:", err));
  } else if (assignmentMode === "specific" && partnerId) {
    pushSent = await sendPushToPartners(supabase, [partnerId], {
      title: "Job assigned",
      body: `${jobRef} · ${title || serviceType} · ${propertyAddress}`,
      data: { type: "job_assigned", jobId },
    });

    // Fire Zendesk side conversation in parallel — best-effort, non-blocking.
    void sendZendeskAssignmentEmail({
      jobId,
      jobReference: jobRef,
      jobTitle: title || serviceType,
      clientName,
      clientPhone: clientPhone || null,
      propertyAddress,
      scope,
      scheduledDate: scheduledDate || null,
      partnerId,
      ticketId,
    }).catch((err) => console.error("[webhook/desk/job] zendesk side conv failed:", err));
  }

  return NextResponse.json({
    ok: true,
    jobId,
    reference: jobRef,
    status,
    action: "created",
    partnersNotified: assignmentMode === "auto" ? matchedPartnerIds.length : (partnerId ? 1 : 0),
    pushSent,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface ZendeskAssignmentEmailParams {
  jobId: string;
  jobReference: string;
  jobTitle: string;
  clientName: string;
  clientPhone: string | null;
  propertyAddress: string;
  scope: string;
  scheduledDate: string | null;
  partnerId: string;
  ticketId: string;
}

async function sendZendeskAssignmentEmail(params: ZendeskAssignmentEmailParams): Promise<void> {
  const supabase = createServiceClient();

  // Look up partner email + name + rate
  const { data: partner } = await supabase
    .from("partners")
    .select("contact_name, company_name, email, zendesk_user_id")
    .eq("id", params.partnerId)
    .maybeSingle();
  const p = partner as { contact_name: string | null; company_name: string | null; email: string | null; zendesk_user_id: string | null } | null;
  if (!p?.email) return;

  // Look up job_type + price for the email pill
  const { data: jobInfo } = await supabase
    .from("jobs")
    .select("job_type, hourly_partner_rate, partner_cost, catalog_service_id, title")
    .eq("id", params.jobId)
    .maybeSingle();
  const ji = jobInfo as {
    job_type: "hourly" | "fixed" | null;
    hourly_partner_rate: number | null;
    partner_cost: number | null;
    catalog_service_id: string | null;
    title: string | null;
  } | null;
  const isHourly = ji?.job_type === "hourly";
  const priceDisplay = isHourly
    ? `£${Number(ji?.hourly_partner_rate ?? 0).toFixed(2)}/hr`
    : `£${Number(ji?.partner_cost ?? 0).toFixed(2)}`;

  const partnerNotes = await loadPartnerJobEmailNotes(supabase, {
    catalogServiceId: ji?.catalog_service_id,
    jobTitle: params.jobTitle || ji?.title,
    jobType: isHourly ? "hourly" : "fixed",
  });

  const partnerFirstName = (p.contact_name?.trim().split(/\s+/)[0])
    || (p.company_name?.trim() ?? "Partner");

  const partnerAppBase = process.env.NEXT_PUBLIC_PARTNER_APP_URL?.trim()?.replace(/\/$/, "")
    || "https://app.getfixfy.com";

  const email = buildPartnerJobConfirmationEmail({
    partnerFirstName,
    jobReference: params.jobReference,
    jobTitle: params.jobTitle,
    clientName: params.clientName,
    propertyAddress: params.propertyAddress,
    scheduledDate: params.scheduledDate,
    scope: params.scope,
    jobType: isHourly ? "hourly" : "fixed",
    priceDisplay,
    partnerNotes,
    reportUrl: `${partnerAppBase}/jobs/${params.jobReference}/report`,
  });

  await createSideConversation({
    ticketId: params.ticketId,
    toEmail:  p.email,
    toName:   p.contact_name || p.company_name || undefined,
    toUserId: p.zendesk_user_id ?? undefined,
    subject:  email.subject,
    htmlBody: email.html,
    bodyText: email.text,
  });
}
