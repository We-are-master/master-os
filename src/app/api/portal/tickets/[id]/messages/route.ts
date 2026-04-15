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
  // Parse body + auth + ticket lookup ALL in parallel to minimize round-trips.
  const { id: ticketId } = await ctx.params;
  const supabase = createServiceClient();

  const [authResult, bodyResult, ticketResult] = await Promise.all([
    requirePortalUser(),
    req.json().catch(() => null) as Promise<{ body?: unknown; attachments?: unknown } | null>,
    supabase
      .from("tickets")
      .select("id, reference, subject, status, account_id, assigned_to")
      .eq("id", ticketId)
      .maybeSingle(),
  ]);

  if (authResult instanceof NextResponse) return authResult;
  const { accountId, portalUser } = authResult;

  const ip = getClientIp(req);
  const rl = checkRateLimit(`portal-ticket-msg:${portalUser.id}:${ip}`, 20, 10 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many messages. Please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const ticket = ticketResult.data;
  if (!ticket || (ticket as { account_id: string }).account_id !== accountId) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }
  const t = ticket as { id: string; reference: string; subject: string; status: string; assigned_to: string | null };

  const message = typeof bodyResult?.body === "string" ? bodyResult.body.trim() : "";
  const attachmentsInput = Array.isArray(bodyResult?.attachments) ? bodyResult.attachments : [];

  // Validate attachments shape — each entry must have a storage path inside
  // the ticket-attachments bucket (we'll resolve to a signed URL on render).
  const attachments = attachmentsInput
    .filter((a): a is { path: string; name: string; type?: string; size?: number } => {
      if (!a || typeof a !== "object") return false;
      const o = a as { path?: unknown; name?: unknown };
      return typeof o.path === "string" && o.path.length > 0 && typeof o.name === "string";
    })
    .slice(0, 6) // max 6 attachments per message
    .map((a) => ({
      path: a.path,
      name: a.name,
      type: typeof a.type === "string" ? a.type : undefined,
      size: typeof a.size === "number" ? a.size : undefined,
    }));

  if (!message && attachments.length === 0) {
    return NextResponse.json({ error: "Message or attachments required." }, { status: 400 });
  }
  if (message.length > 5000) {
    return NextResponse.json({ error: "Message too long (max 5000 characters)." }, { status: 400 });
  }

  // Insert message
  const { error: msgErr } = await supabase.from("ticket_messages").insert({
    ticket_id:   ticketId,
    sender_id:   portalUser.id,
    sender_type: "portal_user",
    sender_name: portalUser.full_name ?? portalUser.email,
    body:        message || "",
    attachments,
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
