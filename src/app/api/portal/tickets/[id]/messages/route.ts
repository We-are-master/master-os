import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requirePortalUser } from "@/lib/portal-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { buildTicketReplyInternalEmail } from "@/lib/ticket-email-templates";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/tickets/[id]/messages
 * Body: { body: string }
 *
 * Portal user adds a message to their ticket. Notifies hello@wearemaster.com
 * and the assigned staff member (if any).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePortalUser();
  if (auth instanceof NextResponse) return auth;
  const { accountId, portalUser } = auth;

  const ip = getClientIp(req);
  const rl = checkRateLimit(`portal-ticket-msg:${portalUser.id}:${ip}`, 20, 10 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many messages. Please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const { id: ticketId } = await ctx.params;
  const supabase = createServiceClient();

  // Ownership check
  const { data: ticket } = await supabase
    .from("tickets")
    .select("id, reference, subject, status, account_id, assigned_to")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket || (ticket as { account_id: string }).account_id !== accountId) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }
  const t = ticket as { id: string; reference: string; subject: string; status: string; assigned_to: string | null };

  let body: { body?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const message = typeof body.body === "string" ? body.body.trim() : "";
  if (!message || message.length > 5000) {
    return NextResponse.json({ error: "Message is required (max 5000 characters)." }, { status: 400 });
  }

  // Insert message
  const { error: msgErr } = await supabase.from("ticket_messages").insert({
    ticket_id:   ticketId,
    sender_id:   portalUser.id,
    sender_type: "portal_user",
    sender_name: portalUser.full_name ?? portalUser.email,
    body:        message,
  });
  if (msgErr) {
    console.error("[portal/tickets/messages] insert failed:", msgErr);
    return NextResponse.json({ error: "Could not send your message." }, { status: 500 });
  }

  // Update ticket timestamp + reopen if resolved. Fire-and-forget.
  const ticketStatus = t.status;
  void supabase.from("tickets").update({
    updated_at: new Date().toISOString(),
    ...(ticketStatus === "resolved" ? { status: "open" } : {}),
  }).eq("id", ticketId);

  // Return immediately — don't block the user waiting for emails.
  const response = NextResponse.json({ ok: true });

  // Email notification (fire-and-forget)
  void (async () => {
    try {
      const resendKey = process.env.RESEND_API_KEY?.trim();
      if (!resendKey) return;
      const resend = new Resend(resendKey);
      const fromEmail = process.env.RESEND_FROM_EMAIL?.trim() || "Master Group <hello@wearemaster.com>";
      const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") || "https://app.getfixfy.com";
      const recipients = ["hello@wearemaster.com"];

      if (t.assigned_to) {
        const { data: staff } = await supabase
          .from("profiles")
          .select("email")
          .eq("id", t.assigned_to)
          .maybeSingle();
        const staffEmail = (staff as { email?: string } | null)?.email;
        if (staffEmail && !recipients.includes(staffEmail)) recipients.push(staffEmail);
      }

      const { data: account } = await supabase
        .from("accounts")
        .select("company_name")
        .eq("id", accountId)
        .maybeSingle();
      const accountName = (account as { company_name?: string } | null)?.company_name ?? "Account";

      const { subject: emailSubject, html } = buildTicketReplyInternalEmail({
        ticketRef:   t.reference,
        subject:     t.subject,
        senderName:  portalUser.full_name ?? portalUser.email,
        accountName,
        body:        message,
        dashboardUrl: `${appUrl}/tickets/${ticketId}`,
      });
      await resend.emails.send({ from: fromEmail, to: recipients, subject: emailSubject, html });
    } catch (err) {
      console.error("[portal/tickets/messages] email notification failed:", err);
    }
  })();

  return response;
}
