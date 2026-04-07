import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import {
  generatePartnerPortalTokenRaw,
  generatePartnerPortalShortCode,
  hashPartnerPortalToken,
} from "@/lib/partner-portal-crypto";
import { getPartnerPortalAllowlistIds, getPartnerPortalAllowlistOptions } from "@/lib/partner-portal-allowlist";
import { escapeHtmlAttr } from "@/lib/email-asset-url";
import type { Partner } from "@/types/database";

export const dynamic = "force-dynamic";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function appOrigin(): string {
  const u =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    "";
  if (!u) return "";
  if (u.startsWith("http")) return u.replace(/\/$/, "");
  return `https://${u.replace(/\/$/, "")}`;
}

/**
 * Admin-only: create a time-limited partner portal URL (document upload + profile).
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const supabaseUser = await import("@/lib/supabase/server").then((m) => m.createClient());
  const { data: profile } = await supabaseUser.from("profiles").select("role").eq("id", auth.user.id).single();
  if ((profile as { role?: string } | null)?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden", message: "Admin only" }, { status: 403 });
  }

  let partnerId: string;
  let expiresInDays = 14;
  let requestedDocIds: string[] = [];
  let sendEmail = true;
  try {
    const body = (await req.json()) as {
      partnerId?: string;
      expiresInDays?: number;
      requestedDocIds?: unknown;
      sendEmail?: unknown;
    };
    partnerId = String(body.partnerId ?? "").trim();
    if (typeof body.expiresInDays === "number" && body.expiresInDays >= 1 && body.expiresInDays <= 90) {
      expiresInDays = body.expiresInDays;
    }
    if (Array.isArray(body.requestedDocIds)) {
      requestedDocIds = body.requestedDocIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim());
    }
    if (typeof body.sendEmail === "boolean") {
      sendEmail = body.sendEmail;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!partnerId || !isValidUUID(partnerId)) {
    return NextResponse.json({ error: "Invalid partnerId" }, { status: 400 });
  }

  if (requestedDocIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one document type to request before generating the link." },
      { status: 400 },
    );
  }

  const admin = createServiceClient();
  const { data: partnerRow, error: exErr } = await admin.from("partners").select("*").eq("id", partnerId).maybeSingle();
  if (exErr || !partnerRow) {
    return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  }

  const partner = partnerRow as Partner;
  const allow = new Set(getPartnerPortalAllowlistIds(partner));
  const invalid = requestedDocIds.filter((id) => !allow.has(id));
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Invalid document selection: ${invalid.join(", ")}` },
      { status: 400 },
    );
  }

  const raw = generatePartnerPortalTokenRaw();
  const tokenHash = hashPartnerPortalToken(raw);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  let insertErr: { message: string; code?: string } | null = null;
  let shortCode: string | null = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generatePartnerPortalShortCode();
    const { error } = await admin.from("partner_portal_tokens").insert({
      partner_id: partnerId,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
      requested_doc_ids: requestedDocIds,
      short_code: code,
    });
    if (!error) {
      shortCode = code;
      insertErr = null;
      break;
    }
    insertErr = error;
    const msg = (error.message ?? "").toLowerCase();
    const isDup = error.code === "23505" || msg.includes("duplicate") || msg.includes("unique");
    if (!isDup) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  if (!shortCode && insertErr) {
    return NextResponse.json(
      { error: insertErr.message ?? "Could not create portal link (try again)." },
      { status: 500 },
    );
  }

  const origin = appOrigin();
  const path = `/partner-upload?token=${encodeURIComponent(raw)}`;
  const url = origin ? `${origin}${path}` : path;
  const pathShort = shortCode ? `/partner-upload?code=${encodeURIComponent(shortCode)}` : path;
  const shortUrl = origin ? `${origin}${pathShort}` : pathShort;

  let emailSent = false;
  let emailTo: string | undefined;
  let emailNotice: string | undefined;

  const partnerEmail = typeof partner.email === "string" ? partner.email.trim() : "";
  const resendKey = process.env.RESEND_API_KEY?.trim();

  const primaryLink = shortUrl || url;
  const linkIsAbsolute = /^https?:\/\//i.test(primaryLink);

  if (sendEmail && partnerEmail) {
    if (!resendKey) {
      emailNotice = "Email was not sent: RESEND_API_KEY is not configured.";
    } else if (!linkIsAbsolute) {
      emailNotice =
        "Email was not sent: set NEXT_PUBLIC_APP_URL (or VERCEL_URL) so the upload link is absolute in the message.";
    } else {
      const opts = getPartnerPortalAllowlistOptions(partner);
      const nameById = new Map(opts.map((o) => [o.id, o.name]));
      const docLabels = requestedDocIds.map((id) => nameById.get(id) ?? id);
      const primaryUrl = primaryLink;
      const longAlt =
        url !== shortUrl
          ? `<p style="margin:12px 0;font-size:13px;color:#666">If you need the full link (for example if the short link does not work):<br/><a href="${escapeHtmlAttr(url)}">${escapeHtml(url)}</a></p>`
          : "";
      const docList = docLabels.map((l) => `<li>${escapeHtml(l)}</li>`).join("");
      const expStr = expiresAt.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      const greet = escapeHtml(partner.contact_name?.trim() || partner.company_name || "there");
      const company = escapeHtml(partner.company_name || "your profile");
      const html = `
<p>Hi ${greet},</p>
<p>We need the following document(s) for <strong>${company}</strong>:</p>
<ul>${docList}</ul>
<p>Please upload them securely using the link below. This link expires on <strong>${escapeHtml(expStr)}</strong>.</p>
<p style="margin:20px 0"><a href="${escapeHtmlAttr(primaryUrl)}" style="display:inline-block;padding:12px 20px;background:#e93701;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Upload documents</a></p>
<p style="font-size:14px">Or copy this address into your browser:<br/><a href="${escapeHtmlAttr(primaryUrl)}">${escapeHtml(primaryUrl)}</a></p>
${longAlt}
<p style="margin-top:24px;font-size:12px;color:#666">If you did not expect this message, you can ignore it or contact the office.</p>
<p style="font-size:12px;color:#666">— Master OS</p>
`;
      const resend = new Resend(resendKey);
      const fromEmail = process.env.RESEND_FROM_EMAIL ?? "Master OS <onboarding@resend.dev>";
      const { error } = await resend.emails.send({
        from: fromEmail,
        to: [partnerEmail],
        subject: `Documents requested — ${partner.company_name || "Partner"}`,
        html,
      });
      if (error) {
        emailNotice = `Email was not sent: ${error.message}`;
      } else {
        emailSent = true;
        emailTo = partnerEmail;
      }
    }
  } else if (sendEmail && !partnerEmail) {
    emailNotice = "Email was not sent: partner has no email address on file.";
  }

  return NextResponse.json({
    url,
    shortUrl,
    expiresAt: expiresAt.toISOString(),
    message: origin ? undefined : "Set NEXT_PUBLIC_APP_URL to return an absolute URL.",
    emailSent,
    emailTo: emailSent ? emailTo : undefined,
    emailNotice,
  });
}
