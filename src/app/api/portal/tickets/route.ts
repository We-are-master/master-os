import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requirePortalUser } from "@/lib/portal-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { buildNewTicketInternalEmail } from "@/lib/ticket-email-templates";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES     = new Set(["general", "billing", "job_related", "complaint"]);
const ALLOWED_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

/**
 * POST /api/portal/tickets
 * multipart/form-data or JSON body:
 *   subject, type, priority, body, job_id (optional)
 *
 * Creates a ticket + first message in one shot. Emails the internal team.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePortalUser();
  if (auth instanceof NextResponse) return auth;
  const { accountId, portalUser } = auth;

  const ip = getClientIp(req);
  const rl = checkRateLimit(`portal-ticket:${portalUser.id}:${ip}`, 5, 60 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "You've created too many tickets recently. Please try again in an hour." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const subject  = typeof body.subject  === "string" ? body.subject.trim()  : "";
  const type     = typeof body.type     === "string" ? body.type.trim()     : "general";
  const priority = typeof body.priority === "string" ? body.priority.trim() : "medium";
  const message  = typeof body.body     === "string" ? body.body.trim()     : "";
  const jobId    = typeof body.job_id   === "string" ? body.job_id.trim()   : null;

  if (!subject || subject.length > 200) {
    return NextResponse.json({ error: "Subject is required (max 200 characters)." }, { status: 400 });
  }
  if (!message || message.length > 5000) {
    return NextResponse.json({ error: "Message is required (max 5000 characters)." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(type)) {
    return NextResponse.json({ error: "Invalid ticket type." }, { status: 400 });
  }
  if (!ALLOWED_PRIORITIES.has(priority)) {
    return NextResponse.json({ error: "Invalid priority." }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Generate reference
  const { data: refData } = await supabase.rpc("next_ticket_ref");
  const reference = (refData as string | null) ?? `TKT-${Date.now()}`;

  // Resolve account name for the email
  const { data: account } = await supabase
    .from("accounts")
    .select("company_name")
    .eq("id", accountId)
    .maybeSingle();
  const accountName = (account as { company_name?: string } | null)?.company_name ?? "Account";

  // Validate job_id belongs to the account (if provided)
  let validJobId: string | null = null;
  if (jobId) {
    const { data: jobRow } = await supabase
      .from("jobs")
      .select("id, client_id")
      .eq("id", jobId)
      .is("deleted_at", null)
      .maybeSingle();
    if (jobRow) {
      const clientId = (jobRow as { client_id?: string }).client_id;
      if (clientId) {
        const { data: client } = await supabase
          .from("clients")
          .select("source_account_id")
          .eq("id", clientId)
          .maybeSingle();
        if ((client as { source_account_id?: string } | null)?.source_account_id === accountId) {
          validJobId = jobId;
        }
      }
    }
  }

  // Create ticket
  const { data: ticketRow, error: ticketErr } = await supabase
    .from("tickets")
    .insert({
      reference,
      account_id: accountId,
      created_by: portalUser.id,
      job_id:     validJobId,
      subject,
      type,
      priority,
    })
    .select("id, reference")
    .single();

  if (ticketErr || !ticketRow) {
    console.error("[portal/tickets] insert failed:", ticketErr);
    return NextResponse.json({ error: "Could not create the ticket." }, { status: 500 });
  }
  const ticketId = (ticketRow as { id: string }).id;

  // Create first message
  await supabase.from("ticket_messages").insert({
    ticket_id:   ticketId,
    sender_id:   portalUser.id,
    sender_type: "portal_user",
    sender_name: portalUser.full_name ?? portalUser.email,
    body:        message,
  });

  // Email to hello@wearemaster.com
  try {
    const resendKey = process.env.RESEND_API_KEY?.trim();
    if (resendKey) {
      const resend = new Resend(resendKey);
      const fromEmail = process.env.RESEND_FROM_EMAIL?.trim() || "Master Group <hello@wearemaster.com>";
      const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") || "https://app.getfixfy.com";
      const { subject: emailSubject, html } = buildNewTicketInternalEmail({
        accountName,
        ticketRef: reference,
        subject,
        type,
        priority,
        body: message,
        senderName: portalUser.full_name ?? portalUser.email,
        dashboardUrl: `${appUrl}/tickets/${ticketId}`,
      });
      await resend.emails.send({
        from: fromEmail,
        to:   ["hello@wearemaster.com"],
        subject: emailSubject,
        html,
      });
    }
  } catch (err) {
    console.error("[portal/tickets] email notification failed:", err);
  }

  return NextResponse.json({ ok: true, ticketId, reference });
}
