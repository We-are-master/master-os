import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { appBaseUrl } from "@/lib/app-base-url";
import { buildPartnerQuoteBidInviteEmail } from "@/lib/emails/partner-quote-bid-invite";
import { normalizeEmailAssetUrl } from "@/lib/email-asset-url";
import { normalizeJsonImageArray } from "@/lib/request-attachment-images";
import { createPartnerBidToken } from "@/lib/quote-response-token";
import { upsertShortLink } from "@/lib/short-links";
import { createSideConversation } from "@/lib/zendesk";

export interface SendQuotePartnerInviteEmailsParams {
  quoteId: string;
  partnerIds: string[];
  invitedBy?: string | null;
}

export interface SendQuotePartnerInviteEmailsResult {
  sent: number;
  invited: number;
}

function partnerFirstName(contactName: string | null | undefined, companyName: string | null | undefined): string {
  const fromContact = contactName?.trim().split(/\s+/)[0];
  if (fromContact) return fromContact;
  return companyName?.trim() || "there";
}

/**
 * Resend bid-invite emails + upsert quote_partner_invitations for portal tracking.
 * Used by OS UI manual invite and automatic dispatch on quote create (webhooks/API).
 */
export async function sendQuotePartnerInviteEmails(
  supabase: SupabaseClient,
  params: SendQuotePartnerInviteEmailsParams,
): Promise<SendQuotePartnerInviteEmailsResult> {
  const partnerIds = params.partnerIds.filter(Boolean);
  if (partnerIds.length === 0) return { sent: 0, invited: 0 };

  const { data: quote, error: qErr } = await supabase
    .from("quotes")
    .select("id, reference, title, client_name, service_type, property_address, request_id, scope, external_source, external_ref")
    .eq("id", params.quoteId)
    .single();
  if (qErr || !quote) {
    console.error("[quote-partner-invite-email] quote not found:", qErr?.message);
    return { sent: 0, invited: 0 };
  }

  // When the quote came from (or is linked to) a Zendesk ticket, bid invites go
  // out as side conversations on that ticket — same channel the job auto-assign
  // flow uses. Without a ticket we fall back to a standalone Resend email.
  const ticketId =
    quote.external_source === "zendesk" ? String(quote.external_ref ?? "").trim() || null : null;

  let photoUrls: string[] = [];
  let requestDescription = "";
  const quoteScope = typeof quote.scope === "string" ? quote.scope.trim() : "";
  if (quote.request_id) {
    const { data: sr } = await supabase
      .from("service_requests")
      .select("images, description")
      .eq("id", quote.request_id)
      .maybeSingle();
    photoUrls = normalizeJsonImageArray(sr?.images)
      .map((u) => normalizeEmailAssetUrl(u))
      .filter((u): u is string => u != null);
    requestDescription = typeof sr?.description === "string" ? sr.description : "";
  }

  const invitationScope = quoteScope || requestDescription.trim();
  const typeOfWork =
    (typeof quote.title === "string" ? quote.title.trim() : "") ||
    (typeof quote.service_type === "string" ? quote.service_type.trim() : "") ||
    "Quote";
  const clientName = typeof quote.client_name === "string" ? quote.client_name.trim() : "";

  const { data: partners } = await supabase
    .from("partners")
    .select("id, email, company_name, contact_name, zendesk_user_id")
    .in("id", partnerIds);

  const resendKey = process.env.RESEND_API_KEY?.trim();
  // Side conversations only need Zendesk; the Resend key is required only for
  // the email fallback. Bail out only when neither channel is available.
  if (!ticketId && !resendKey) {
    console.warn("[quote-partner-invite-email] no Zendesk ticket and RESEND_API_KEY not configured");
    await upsertQuotePartnerInvitations(supabase, params.quoteId, partnerIds, params.invitedBy ?? null, "email");
    return { sent: 0, invited: partnerIds.length };
  }

  const resend = resendKey ? new Resend(resendKey) : null;
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "Fixfy <quotes@example.com>";
  const base = appBaseUrl();
  const invitedAt = new Date();

  const iosStore = process.env.PARTNER_APP_IOS_URL?.trim() || process.env.NEXT_PUBLIC_PARTNER_APP_IOS_URL?.trim();
  const androidStore =
    process.env.PARTNER_APP_ANDROID_URL?.trim() || process.env.NEXT_PUBLIC_PARTNER_APP_ANDROID_URL?.trim();
  const deepLink = `masterservices://invite?quoteId=${encodeURIComponent(params.quoteId)}`;
  const officeQuoteUrl = `${base}/quotes?quoteId=${encodeURIComponent(params.quoteId)}&drawerTab=bids`;

  const sendOne = async (p: {
    id: string;
    email?: string | null;
    company_name?: string | null;
    contact_name?: string | null;
    zendesk_user_id?: string | null;
  }) => {
    const email = p.email?.trim();
    if (!email) return false;
    const bidToken = createPartnerBidToken(params.quoteId, p.id);
    const targetPath = `/quote/bid?token=${encodeURIComponent(bidToken)}`;
    const { shortPath } = await upsertShortLink({
      targetPath,
      kind: "partner_bid",
      entityRef: `quote:${params.quoteId}:partner:${p.id}`,
      createdBy: params.invitedBy ?? null,
    }).catch((err) => {
      console.error("[quote-partner-invite-email] short link upsert failed, falling back:", err);
      return { shortPath: targetPath };
    });
    const bidWebUrl = `${base}${shortPath}`;

    const { subject, html, text: bodyText } = buildPartnerQuoteBidInviteEmail({
      partnerFirstName: partnerFirstName(p.contact_name, p.company_name),
      quoteReference: quote.reference,
      typeOfWork,
      clientName: clientName || "—",
      propertyAddress: quote.property_address ?? "",
      scope: invitationScope,
      photoUrls,
      bidUrl: bidWebUrl,
      deepLinkUrl: deepLink,
      iosStoreUrl: iosStore,
      androidStoreUrl: androidStore,
      officeQuoteUrl,
      invitedAt,
    });

    // Prefer a Zendesk side conversation on the quote's ticket; fall back to a
    // standalone Resend email when there's no ticket (or Zendesk send fails).
    if (ticketId) {
      const sc = await createSideConversation({
        ticketId,
        toEmail: email,
        toName: p.contact_name || p.company_name || undefined,
        toUserId: p.zendesk_user_id ?? undefined,
        subject,
        htmlBody: html,
        bodyText,
      });
      if (sc.ok) return true;
      console.error(`[quote-partner-invite-email] side conv failed for partner ${p.id}, falling back to email:`, sc.error);
    }

    if (!resend) return false;
    const { error } = await resend.emails.send({ from: fromEmail, to: [email], subject, html });
    return !error;
  };

  const results = await Promise.all(
    (partners ?? []).map((p) =>
      sendOne(
        p as {
          id: string;
          email?: string | null;
          company_name?: string | null;
          contact_name?: string | null;
          zendesk_user_id?: string | null;
        },
      ),
    ),
  );
  const sent = results.filter(Boolean).length;

  await upsertQuotePartnerInvitations(
    supabase,
    params.quoteId,
    partnerIds,
    params.invitedBy ?? null,
    ticketId ? "side_conversation" : "email",
  );

  return { sent, invited: partnerIds.length };
}

async function upsertQuotePartnerInvitations(
  supabase: SupabaseClient,
  quoteId: string,
  partnerIds: string[],
  invitedBy: string | null,
  channel: string,
): Promise<void> {
  if (partnerIds.length === 0) return;
  const nowIso = new Date().toISOString();
  const rows = partnerIds.map((pid) => ({
    quote_id: quoteId,
    partner_id: pid,
    invited_by: invitedBy,
    invited_at: nowIso,
    last_invited_at: nowIso,
    last_channel: channel,
  }));
  const { error } = await supabase.from("quote_partner_invitations").upsert(rows, { onConflict: "quote_id,partner_id" });
  if (error) console.error("[quote-partner-invite-email] invitations upsert failed:", error.message);
}
