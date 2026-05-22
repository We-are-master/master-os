import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createSideConversation, getZendeskTicketId, isZendeskConfigured } from "@/lib/zendesk";
import { buildPartnerJobBookedFromBidEmail } from "@/lib/emails/partner-job-confirmation";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * POST /api/quotes/[id]/notify-partner-bid-approved
 *
 * Fired by the UI right after a partner bid is approved. The job doesn't
 * exist yet (the customer still has to accept the quote), but the partner
 * already committed via their bid, so we open a Side Conversation on the
 * quote's parent ticket with the "Bid approved — job booked" email.
 *
 * When the quote later converts to a job, createJob copies
 * `quotes.zendesk_side_conversation_id` → `jobs.zendesk_side_conversation_id`
 * so subsequent events (status changes, on_hold, completed) reply on the
 * same thread the partner already sees in their inbox.
 *
 * Body: { partnerId?: string }   — defaults to quote.partner_id
 *
 * Returns: { ok: true, sideConversationId?: string, skipped?: string }
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
  if (!ALLOWED_ROLES.has(role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const { id: quoteId } = await ctx.params;
  if (!quoteId) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  let body: { partnerId?: string } = {};
  try { body = (await req.json()) as { partnerId?: string }; } catch { /* empty body OK */ }

  const supabase = createServiceClient();

  const { data: quoteRow } = await supabase
    .from("quotes")
    .select("id, reference, title, scope, client_name, property_address, partner_id, partner_cost, total_value, external_source, external_ref, zendesk_side_conversation_id")
    .eq("id", quoteId)
    .maybeSingle();

  if (!quoteRow) return NextResponse.json({ ok: false, error: "quote_not_found" }, { status: 404 });
  type QuoteRow = {
    id: string;
    reference: string;
    title: string | null;
    scope: string | null;
    client_name: string | null;
    property_address: string | null;
    partner_id: string | null;
    partner_cost: number | null;
    total_value: number | null;
    external_source: string | null;
    external_ref: string | null;
    zendesk_side_conversation_id: string | null;
  };
  const quote = quoteRow as QuoteRow;

  const partnerId = (body.partnerId?.trim() || quote.partner_id || "").trim();
  if (!partnerId) {
    return NextResponse.json({ ok: true, skipped: "no_partner_on_quote" });
  }

  const ticketId = getZendeskTicketId({
    external_source: quote.external_source,
    external_ref:    quote.external_ref,
  });
  if (!ticketId) {
    return NextResponse.json({ ok: true, skipped: "quote_not_linked_to_zendesk" });
  }
  if (!isZendeskConfigured()) {
    return NextResponse.json({ ok: true, skipped: "zendesk_not_configured" });
  }
  if (quote.zendesk_side_conversation_id) {
    // Idempotent — partner already received the bid-approved email on this quote
    return NextResponse.json({
      ok: true,
      sideConversationId: quote.zendesk_side_conversation_id,
      skipped: "already_sent",
    });
  }

  const { data: partnerRow } = await supabase
    .from("partners")
    .select("id, contact_name, company_name, email")
    .eq("id", partnerId)
    .maybeSingle();
  const partner = partnerRow as { id: string; contact_name: string | null; company_name: string | null; email: string | null } | null;
  if (!partner) return NextResponse.json({ ok: true, skipped: "partner_not_found" });
  if (!partner.email) return NextResponse.json({ ok: true, skipped: "partner_has_no_email" });

  const partnerFirstName =
    partner.contact_name?.trim().split(/\s+/)[0] || partner.company_name?.trim() || "Partner";
  const partnerAppBase = process.env.NEXT_PUBLIC_PARTNER_APP_URL?.trim()?.replace(/\/$/, "")
    || "https://app.getfixfy.com";

  const priceDisplay = `£${Number(quote.partner_cost ?? quote.total_value ?? 0).toFixed(2)}`;

  const email = buildPartnerJobBookedFromBidEmail({
    partnerFirstName,
    jobReference:    quote.reference,
    jobTitle:        quote.title || "Job",
    clientName:      quote.client_name || "—",
    propertyAddress: quote.property_address || "—",
    scope:           quote.scope || "(no scope provided)",
    priceDisplay,
    reportUrl:       `${partnerAppBase}/jobs/${quote.reference}/report`,
  });

  const r = await createSideConversation({
    ticketId,
    toEmail:  partner.email,
    toName:   partner.contact_name || partner.company_name || undefined,
    subject:  email.subject,
    htmlBody: email.html,
    bodyText: email.text,
  });

  if (!r.ok || !r.id) {
    console.error("[notify-partner-bid-approved] side conversation failed:", r.error);
    return NextResponse.json({ ok: false, error: r.error ?? "side_conversation_failed" }, { status: 502 });
  }

  await supabase
    .from("quotes")
    .update({ zendesk_side_conversation_id: r.id })
    .eq("id", quote.id);

  return NextResponse.json({ ok: true, sideConversationId: r.id });
}
