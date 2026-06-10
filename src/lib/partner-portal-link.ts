import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generatePartnerPortalShortCode,
  generatePartnerPortalTokenRaw,
  hashPartnerPortalToken,
} from "@/lib/partner-portal-crypto";
import {
  buildPartnerUploadEmailHTML,
} from "@/lib/partner-upload-email-template";
import {
  buildPartnerOnboardingRefreshEmailHTML,
  PARTNER_ONBOARDING_EMAIL_SUBJECT,
  resolvePartnerTradeLabel,
} from "@/lib/partner-onboarding-email-template";
import type { CompanyBranding } from "@/lib/pdf/quote-template";
import { resolvePartnerTradePortalBaseUrl } from "@/lib/trade-auth";

const DEFAULT_FROM_EMAIL = "Fixfy <support@getfixfy.com>";

export type PartnerPortalLinkKind = "trade_onboarding" | "document_request";

export type CreatePartnerPortalLinkInput = {
  partnerId: string;
  sendEmail?: boolean;
  customMessage?: string;
  /** Omit or null = full compliance checklist; non-empty = scoped upload. */
  requestedDocIds?: string[] | null;
  expiresInDays?: number;
  requestedByUserId?: string;
  /** OS app origin — document upload portal (`/partner-upload`). */
  osBaseUrl: string;
  /** Trade portal origin (`partners.getfixfy.com`) — sign-in and join invites. */
  tradePortalBaseUrl?: string;
  /** Trade Portal apply/sign-in vs OS document upload portal. */
  linkKind?: PartnerPortalLinkKind;
};

export type CreatePartnerPortalLinkResult = {
  onboardingUrl: string;
  fullUrl: string;
  shortUrl: string;
  expiresAt: string;
  tokenId: string | null;
  sentTo?: string;
  emailSent?: boolean;
  emailError?: string | null;
  warning?: string;
  linkKind: PartnerPortalLinkKind;
};

async function loadCompanyBranding(supabase: SupabaseClient): Promise<CompanyBranding> {
  try {
    const { data: settings } = await supabase.from("company_settings").select("*").limit(1).single();
    const s = (settings ?? {}) as Record<string, unknown>;
    return {
      companyName: String(s.company_name ?? "Fixfy"),
      logoUrl: s.logo_url ? String(s.logo_url) : undefined,
      address: String(s.address ?? "124 City Road, London, UK"),
      phone: String(s.phone ?? ""),
      email: String(s.email ?? "support@getfixfy.com"),
      website: s.website ? String(s.website) : undefined,
      vatNumber: s.vat_number ? String(s.vat_number) : undefined,
      primaryColor: String(s.primary_color ?? "#F97316"),
      tagline: s.tagline ? String(s.tagline) : undefined,
    };
  } catch {
    return {
      companyName: "Fixfy",
      address: "124 City Road, London, UK",
      phone: "",
      email: "support@getfixfy.com",
      primaryColor: "#F97316",
    };
  }
}

function normalizeExpiresInDays(days: number | undefined): number {
  const n = typeof days === "number" && Number.isFinite(days) ? Math.round(days) : 7;
  return Math.min(90, Math.max(1, n));
}

function normalizeRequestedDocIds(ids: string[] | null | undefined): string[] | null {
  if (ids == null) return null;
  const cleaned = ids
    .filter((id): id is string => typeof id === "string")
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id.length <= 80)
    .slice(0, 25);
  return cleaned.length > 0 ? cleaned : null;
}

function resolveLinkKind(
  requestedDocIds: string[] | null,
  explicit?: PartnerPortalLinkKind,
): PartnerPortalLinkKind {
  if (explicit) return explicit;
  return requestedDocIds != null && requestedDocIds.length > 0
    ? "document_request"
    : "trade_onboarding";
}

async function insertPortalTokenWithRetry(
  supabase: SupabaseClient,
  row: {
    partner_id: string;
    token_hash: string;
    short_code: string;
    expires_at: string;
    requested_doc_ids: string[] | null;
  },
  maxAttempts = 5,
): Promise<{ id: string; expires_at: string; short_code: string }> {
  let lastError: { message?: string } | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const shortCode = attempt === 0 ? row.short_code : generatePartnerPortalShortCode();
    const { data, error } = await supabase
      .from("partner_portal_tokens")
      .insert({
        partner_id: row.partner_id,
        token_hash: row.token_hash,
        short_code: shortCode,
        expires_at: row.expires_at,
        requested_doc_ids: row.requested_doc_ids,
      })
      .select("id, expires_at, short_code")
      .single();

    if (!error && data) {
      return data as { id: string; expires_at: string; short_code: string };
    }
    lastError = error;
    if (error?.code !== "23505") break;
  }
  throw new Error(lastError?.message ?? "Failed to create portal token");
}

async function sendPartnerEmail(
  supabase: SupabaseClient,
  input: {
    partnerEmail: string;
    partnerName: string;
    tradeLabel: string;
    onboardingUrl: string;
    expiresAt: Date;
    customMessage?: string;
    linkKind: PartnerPortalLinkKind;
  },
): Promise<{ emailSent: boolean; emailError: string | null; warning?: string }> {
  const branding = await loadCompanyBranding(supabase);
  const html =
    input.linkKind === "trade_onboarding"
      ? buildPartnerOnboardingRefreshEmailHTML(branding, {
          contactName: input.partnerName,
          email: input.partnerEmail,
          tradeLabel: input.tradeLabel,
          onboardingUrl: input.onboardingUrl,
          customMessage: input.customMessage,
        })
      : buildPartnerUploadEmailHTML(branding, {
          partnerName: input.partnerName,
          uploadUrl: input.onboardingUrl,
          expiresAt: input.expiresAt,
          customMessage: input.customMessage,
        });

  const subject =
    input.linkKind === "trade_onboarding"
      ? PARTNER_ONBOARDING_EMAIL_SUBJECT
      : `${branding.companyName} — please update your documents`;

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    return { emailSent: false, emailError: null, warning: "RESEND_API_KEY not set — email not sent" };
  }

  try {
    const resend = new Resend(resendKey);
    const fromEmail = process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM_EMAIL;
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: [input.partnerEmail],
      subject,
      html,
    });
    if (error) {
      return { emailSent: false, emailError: error.message ?? "Resend send failed" };
    }
    return { emailSent: true, emailError: null };
  } catch (e) {
    return { emailSent: false, emailError: e instanceof Error ? e.message : "Email send failed" };
  }
}

export async function createPartnerPortalLink(
  supabase: SupabaseClient,
  input: CreatePartnerPortalLinkInput,
): Promise<CreatePartnerPortalLinkResult> {
  const sendEmail = input.sendEmail ?? false;
  const expiresInDays = normalizeExpiresInDays(input.expiresInDays);
  const requestedDocIds = normalizeRequestedDocIds(input.requestedDocIds);
  const linkKind = resolveLinkKind(requestedDocIds, input.linkKind);
  const customMessage = input.customMessage?.trim().slice(0, 2000) || undefined;

  const { data: partner, error: partnerErr } = await supabase
    .from("partners")
    .select("id, company_name, contact_name, email, auth_user_id, trade, trades")
    .eq("id", input.partnerId)
    .maybeSingle();

  if (partnerErr || !partner) {
    throw Object.assign(new Error("Partner not found"), { status: 404 });
  }

  const partnerEmail = (partner as { email?: string | null }).email?.trim() ?? "";
  if (!partnerEmail) {
    throw Object.assign(new Error("Partner has no email on file. Add one before sending the link."), {
      status: 422,
    });
  }

  const partnerName =
    (partner as { contact_name?: string | null }).contact_name?.trim() ||
    (partner as { company_name?: string | null }).company_name?.trim() ||
    "there";

  const tradeLabel = resolvePartnerTradeLabel(
    partner as { trade?: string | null; trades?: string[] | null },
  );

  const osBaseUrl = input.osBaseUrl.replace(/\/$/, "");
  const tradePortalBaseUrl = (input.tradePortalBaseUrl ?? resolvePartnerTradePortalBaseUrl()).replace(
    /\/$/,
    "",
  );
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  const authUserId = (partner as { auth_user_id?: string | null }).auth_user_id?.trim() || null;

  let onboardingUrl = "";
  let fullUrl = "";
  let tokenId: string | null = null;
  let expiresAtIso = expiresAt.toISOString();

  if (linkKind === "trade_onboarding" && authUserId) {
    onboardingUrl = `${tradePortalBaseUrl}/?email=${encodeURIComponent(partnerEmail)}`;
    fullUrl = onboardingUrl;
    expiresAtIso = expiresAt.toISOString();
  } else {
    const rawToken = generatePartnerPortalTokenRaw();
    const shortCode = generatePartnerPortalShortCode();
    const tokenRow = await insertPortalTokenWithRetry(supabase, {
      partner_id: input.partnerId,
      token_hash: hashPartnerPortalToken(rawToken),
      short_code: shortCode,
      expires_at: expiresAt.toISOString(),
      requested_doc_ids: linkKind === "document_request" ? requestedDocIds : null,
    });
    tokenId = tokenRow.id;
    expiresAtIso = tokenRow.expires_at;
    const code = tokenRow.short_code;

    if (linkKind === "trade_onboarding") {
      onboardingUrl = `${tradePortalBaseUrl}/join?invite=${encodeURIComponent(code)}`;
      fullUrl = onboardingUrl;
    } else {
      onboardingUrl = `${osBaseUrl}/partner-upload?code=${encodeURIComponent(code)}`;
      fullUrl = `${osBaseUrl}/partner-upload?token=${encodeURIComponent(rawToken)}`;
    }
  }

  let emailSent = false;
  let emailError: string | null = null;
  let warning: string | undefined;

  if (sendEmail) {
    const mail = await sendPartnerEmail(supabase, {
      partnerEmail,
      partnerName,
      tradeLabel,
      onboardingUrl,
      expiresAt: new Date(expiresAtIso),
      customMessage,
      linkKind,
    });
    emailSent = mail.emailSent;
    emailError = mail.emailError;
    warning = mail.warning;
  }

  void supabase
    .from("audit_logs")
    .insert({
      entity_type: "partner",
      entity_id: input.partnerId,
      entity_ref: (partner as { company_name?: string | null }).company_name ?? null,
      action: "partner_onboarding_link_sent",
      field_name: null,
      old_value: null,
      new_value: null,
      metadata: {
        token_id: tokenId,
        sent_to: partnerEmail,
        email_sent: emailSent,
        send_email_requested: sendEmail,
        requested_doc_ids: requestedDocIds,
        link_kind: linkKind,
        requested_by: input.requestedByUserId ?? null,
      },
    })
    .then(({ error }) => {
      if (error) console.error("audit_logs insert (partner_onboarding_link_sent)", error);
    });

  return {
    onboardingUrl,
    shortUrl: onboardingUrl,
    fullUrl,
    expiresAt: expiresAtIso,
    tokenId,
    sentTo: partnerEmail,
    emailSent,
    emailError,
    warning,
    linkKind,
  };
}
