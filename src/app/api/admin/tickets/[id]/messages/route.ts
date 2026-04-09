import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { buildTicketReplyPortalEmail } from "@/lib/ticket-email-templates";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * POST /api/admin/tickets/[id]/messages
 * Body: { body: string }
 *
 * Staff reply to a ticket. Notifies all portal users of the ticket's account.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  // Auth + body parse + ticket lookup ALL in parallel
  const { id: ticketId } = await ctx.params;
  const supabase = createServiceClient();

  const [authResult, serverSupabase, bodyResult, ticketResult] = await Promise.all([
    requireAuth(),
    createServerSupabase(),
    req.json().catch(() => null) as Promise<{ body?: unknown } | null>,
    supabase
      .from("tickets")
      .select("id, reference, subject, account_id, status")
      .eq("id", ticketId)
      .maybeSingle(),
  ]);

  if (authResult instanceof NextResponse) return authResult;
  const auth = authResult;

  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role, full_name, email")
    .eq("id", auth.user.id)
    .maybeSingle();
  const p = profile as { role?: string; full_name?: string; email?: string } | null;
  if (!ALLOWED_ROLES.has(p?.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ticket = ticketResult.data;
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }
  const t = ticket as { id: string; reference: string; subject: string; account_id: string; status: string };

  const message = typeof bodyResult?.body === "string" ? bodyResult.body.trim() : "";
  if (!message || message.length > 5000) {
    return NextResponse.json({ error: "Message is required (max 5000 characters)." }, { status: 400 });
  }

  // Insert message
  const senderName = p?.full_name ?? p?.email ?? "Master team";
  const { error: msgErr } = await supabase.from("ticket_messages").insert({
    ticket_id:   ticketId,
    sender_id:   auth.user.id,
    sender_type: "staff",
    sender_name: senderName,
    body:        message,
  });
  if (msgErr) {
    console.error("[admin/tickets/messages] insert failed:", msgErr);
    return NextResponse.json({ error: "Could not send your reply." }, { status: 500 });
  }

  // Update ticket timestamp + move to awaiting_customer if open/in_progress.
  // Fire-and-forget — don't block the response on this.
  const newStatus = (t.status === "open" || t.status === "in_progress")
    ? "awaiting_customer"
    : t.status;
  void supabase.from("tickets").update({
    updated_at: new Date().toISOString(),
    status: newStatus,
    assigned_to: auth.user.id,
  }).eq("id", ticketId);

  // Return immediately — the user sees the reply in the chat.
  // Email notification runs fire-and-forget below.
  const response = NextResponse.json({ ok: true });

  // Email notification to portal users (fire-and-forget, non-blocking)
  void (async () => {
    try {
      const resendKey = process.env.RESEND_API_KEY?.trim();
      if (!resendKey) return;
      const resend = new Resend(resendKey);
      const fromEmail = process.env.RESEND_FROM_EMAIL?.trim() || "Master Group <hello@wearemaster.com>";
      const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") || "https://app.getfixfy.com";

      const { data: portalUsers } = await supabase
        .from("account_portal_users")
        .select("email, full_name, is_active")
        .eq("account_id", t.account_id)
        .eq("is_active", true);

      const users = (portalUsers ?? []) as Array<{ email: string; full_name: string | null }>;
      // Send to all portal users in one API call (multiple recipients)
      const emails = users.map((u) => u.email).filter((e) => e?.includes("@"));
      if (emails.length === 0) return;

      const { subject: emailSubject, html } = buildTicketReplyPortalEmail({
        recipientName: users[0]?.full_name ?? emails[0]!,
        ticketRef:     t.reference,
        subject:       t.subject,
        senderName,
        body:          message,
        portalUrl:     `${appUrl}/portal/tickets/${ticketId}`,
      });
      await resend.emails.send({ from: fromEmail, to: emails, subject: emailSubject, html });
    } catch (err) {
      console.error("[admin/tickets/messages] email notification failed:", err);
    }
  })();

  return response;
}
