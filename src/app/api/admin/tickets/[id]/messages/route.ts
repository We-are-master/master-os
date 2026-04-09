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
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role, full_name, email")
    .eq("id", auth.user.id)
    .maybeSingle();
  const p = profile as { role?: string; full_name?: string; email?: string } | null;
  if (!ALLOWED_ROLES.has(p?.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: ticketId } = await ctx.params;
  let body: { body?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const message = typeof body.body === "string" ? body.body.trim() : "";
  if (!message || message.length > 5000) {
    return NextResponse.json({ error: "Message is required (max 5000 characters)." }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Load ticket for metadata
  const { data: ticket } = await supabase
    .from("tickets")
    .select("id, reference, subject, account_id, status")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }
  const t = ticket as { id: string; reference: string; subject: string; account_id: string; status: string };

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

  // Update ticket timestamp + move to awaiting_customer if open/in_progress
  const newStatus = (t.status === "open" || t.status === "in_progress")
    ? "awaiting_customer"
    : t.status;
  await supabase.from("tickets").update({
    updated_at: new Date().toISOString(),
    status: newStatus,
    assigned_to: auth.user.id,
  }).eq("id", ticketId);

  // Email notification to all portal users of this account
  try {
    const resendKey = process.env.RESEND_API_KEY?.trim();
    if (resendKey) {
      const resend = new Resend(resendKey);
      const fromEmail = process.env.RESEND_FROM_EMAIL?.trim() || "Master Group <hello@wearemaster.com>";
      const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") || "https://app.getfixfy.com";

      const { data: portalUsers } = await supabase
        .from("account_portal_users")
        .select("email, full_name, is_active")
        .eq("account_id", t.account_id)
        .eq("is_active", true);

      const users = (portalUsers ?? []) as Array<{ email: string; full_name: string | null }>;
      for (const u of users) {
        if (!u.email?.includes("@")) continue;
        const { subject: emailSubject, html } = buildTicketReplyPortalEmail({
          recipientName: u.full_name ?? u.email,
          ticketRef:     t.reference,
          subject:       t.subject,
          senderName,
          body:          message,
          portalUrl:     `${appUrl}/portal/tickets/${ticketId}`,
        });
        await resend.emails.send({ from: fromEmail, to: [u.email], subject: emailSubject, html });
      }
    }
  } catch (err) {
    console.error("[admin/tickets/messages] email notification failed:", err);
  }

  return NextResponse.json({ ok: true });
}
