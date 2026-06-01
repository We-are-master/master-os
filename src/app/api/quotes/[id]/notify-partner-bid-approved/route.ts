import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createSideConversation, getZendeskTicketId, isZendeskConfigured } from "@/lib/zendesk";
import { buildPartnerJobBookedFromBidEmail } from "@/lib/emails/partner-job-confirmation";
import { loadPartnerJobEmailNotes } from "@/lib/partner-job-email-notes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * POST /api/quotes/[id]/notify-partner-bid-approved
 *
 * Fired by the UI right after a partner bid is approved. Opens a Side
 * Conversation on the quote's parent ticket (or Resend when not linked).
 * Single email: bid approved + job confirmation + report link.
 *
 * Body: { partnerId?: string }   — defaults to quote.partner_id
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
  try {
    body = (await req.json()) as { partnerId?: string };
  } catch {
    /* empty body OK */
  }

  const supabase = createServiceClient();

  const { data: quoteRow } = await supabase
    .from("quotes")
    .select(
      "id, reference, title, scope, client_name, property_address, partner_id, partner_cost, total_value, external_source, external_ref, zendesk_side_conversation_id, catalog_service_id, start_date_option_1",
    )
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
    catalog_service_id: string | null;
    start_date_option_1: string | null;
  };
  const quote = quoteRow as QuoteRow;

  const partnerId = (body.partnerId?.trim() || quote.partner_id || "").trim();
  if (!partnerId) {
    return NextResponse.json({ ok: true, skipped: "no_partner_on_quote" });
  }

  if (quote.zendesk_side_conversation_id) {
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
  const partner = partnerRow as {
    id: string;
    contact_name: string | null;
    company_name: string | null;
    email: string | null;
  } | null;
  if (!partner) return NextResponse.json({ ok: true, skipped: "partner_not_found" });
  if (!partner.email) return NextResponse.json({ ok: true, skipped: "partner_has_no_email" });

  const partnerFirstName =
    partner.contact_name?.trim().split(/\s+/)[0] || partner.company_name?.trim() || "Partner";
  const partnerAppBase =
    process.env.NEXT_PUBLIC_PARTNER_APP_URL?.trim()?.replace(/\/$/, "") || "https://app.getfixfy.com";

  const priceDisplay = `£${Number(quote.partner_cost ?? quote.total_value ?? 0).toFixed(2)}`;
  const scheduledDate = quote.start_date_option_1?.slice(0, 10) ?? null;
  const partnerNotes = await loadPartnerJobEmailNotes(supabase, {
    catalogServiceId: quote.catalog_service_id,
    jobType: "fixed",
  });

  const email = buildPartnerJobBookedFromBidEmail({
    partnerFirstName,
    jobReference: quote.reference,
    jobTitle: quote.title || "Job",
    clientName: quote.client_name || "—",
    propertyAddress: quote.property_address || "—",
    scheduledDate,
    scope: quote.scope || "(no scope provided)",
    priceDisplay,
    reportUrl: `${partnerAppBase}/jobs/${quote.reference}/report`,
    partnerNotes,
  });

  const ticketId = getZendeskTicketId({
    external_source: quote.external_source,
    external_ref: quote.external_ref,
  });

  if (ticketId && isZendeskConfigured()) {
    const r = await createSideConversation({
      ticketId,
      toEmail: partner.email,
      toName: partner.contact_name || partner.company_name || undefined,
      subject: email.subject,
      htmlBody: email.html,
      bodyText: email.text,
    });

    if (!r.ok || !r.id) {
      console.error("[notify-partner-bid-approved] side conversation failed:", r.error);
      return NextResponse.json({ ok: false, error: r.error ?? "side_conversation_failed" }, { status: 502 });
    }

    await supabase.from("quotes").update({ zendesk_side_conversation_id: r.id }).eq("id", quote.id);

    return NextResponse.json({ ok: true, sideConversationId: r.id, channel: "zendesk" });
  }

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    return NextResponse.json({ ok: true, skipped: "no_zendesk_or_resend" });
  }

  const resend = new Resend(resendKey);
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "Fixfy <quotes@example.com>";
  const { error: sendErr } = await resend.emails.send({
    from: fromEmail,
    to: [partner.email],
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
  if (sendErr) {
    console.error("[notify-partner-bid-approved] resend failed:", sendErr);
    return NextResponse.json({ ok: false, error: "resend_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, channel: "resend" });
}
