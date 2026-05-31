import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { appBaseUrl } from "@/lib/app-base-url";
import { escapeHtmlAttr, normalizeEmailAssetUrl } from "@/lib/email-asset-url";
import { normalizeJsonImageArray } from "@/lib/request-attachment-images";
import { createPartnerBidToken } from "@/lib/quote-response-token";
import { upsertShortLink } from "@/lib/short-links";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface SendQuotePartnerInviteEmailsParams {
  quoteId: string;
  partnerIds: string[];
  invitedBy?: string | null;
}

export interface SendQuotePartnerInviteEmailsResult {
  sent: number;
  invited: number;
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
    .select("id, reference, title, property_address, request_id, scope")
    .eq("id", params.quoteId)
    .single();
  if (qErr || !quote) {
    console.error("[quote-partner-invite-email] quote not found:", qErr?.message);
    return { sent: 0, invited: 0 };
  }

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
  const { data: partners } = await supabase
    .from("partners")
    .select("id, email, company_name, contact_name")
    .in("id", partnerIds);

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    console.warn("[quote-partner-invite-email] RESEND_API_KEY not configured");
    await upsertQuotePartnerInvitations(supabase, params.quoteId, partnerIds, params.invitedBy ?? null, "email");
    return { sent: 0, invited: partnerIds.length };
  }

  const resend = new Resend(resendKey);
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "Fixfy <quotes@example.com>";
  const base = appBaseUrl();

  const imgHtml = photoUrls
    .map((u, i) => {
      const href = escapeHtmlAttr(u);
      return `<p style="margin:12px 0"><a href="${href}">Site photo ${i + 1}</a></p><img src="${href}" alt="" width="560" style="max-width:100%;height:auto;border-radius:8px;border:1px solid #e5e5e5" />`;
    })
    .join("");

  const iosStore = process.env.PARTNER_APP_IOS_URL?.trim() || process.env.NEXT_PUBLIC_PARTNER_APP_IOS_URL?.trim();
  const androidStore =
    process.env.PARTNER_APP_ANDROID_URL?.trim() || process.env.NEXT_PUBLIC_PARTNER_APP_ANDROID_URL?.trim();
  const deepLink = `masterservices://invite?quoteId=${encodeURIComponent(params.quoteId)}`;
  const deepEsc = escapeHtmlAttr(deepLink);
  const storeLinks: string[] = [];
  if (iosStore) storeLinks.push(`<a href="${escapeHtmlAttr(iosStore)}">App Store</a>`);
  if (androidStore) storeLinks.push(`<a href="${escapeHtmlAttr(androidStore)}">Google Play</a>`);
  const storeBlock =
    storeLinks.length > 0
      ? `<p style="margin:12px 0">${storeLinks.join(" · ")}</p>`
      : `<p style="margin:12px 0;color:#444;font-size:14px">Install <strong>Fixfy</strong> from the App Store or Google Play, sign in, then open <strong>Invites</strong> to view this request and submit your bid.</p>`;

  const officeQuoteUrl = `${base}/quotes?quoteId=${encodeURIComponent(params.quoteId)}&drawerTab=bids`;
  const officeEsc = escapeHtmlAttr(officeQuoteUrl);

  const sendOne = async (p: { id: string; email?: string | null; company_name?: string | null }) => {
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
    const bidWebEsc = escapeHtmlAttr(bidWebUrl);
    const html = `
        <p>Hi ${escapeHtml(p.company_name ?? "there")},</p>
        <p>You have been invited to bid on <strong>${escapeHtml(quote.reference)}</strong> — ${escapeHtml(quote.title ?? "")}</p>
        <p><strong>Property:</strong> ${escapeHtml(quote.property_address ?? "—")}</p>
        ${invitationScope ? `<p><strong>Scope:</strong><br/>${escapeHtml(invitationScope).replace(/\n/g, "<br/>")}</p>` : ""}
        ${imgHtml || "<p><em>No site photos were attached to this request.</em></p>"}
        <p style="margin-top:20px"><strong>Submit your bid</strong></p>
        <p style="margin:12px 0;font-size:14px"><a href="${bidWebEsc}" style="display:inline-block;background:#020040;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">Open bid form</a></p>
        <p style="margin:8px 0;font-size:12px;color:#666">Or open in the Fixfy partner app: <a href="${deepEsc}">in-app invitation</a></p>
        ${storeBlock}
        <p style="margin-top:16px;font-size:12px;color:#666">Office link (login required): <a href="${officeEsc}">View quote in Fixfy OS</a></p>
      `;
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: [email],
      subject: `Quote invitation ${quote.reference} — ${quote.title ?? "Bid request"}`,
      html,
    });
    return !error;
  };

  const results = await Promise.all(
    (partners ?? []).map((p) => sendOne(p as { id: string; email?: string | null; company_name?: string | null })),
  );
  const sent = results.filter(Boolean).length;

  await upsertQuotePartnerInvitations(supabase, params.quoteId, partnerIds, params.invitedBy ?? null, "email");

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
