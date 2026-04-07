/**
 * Branded HTML email for partner self-service document/profile upload links.
 * Mirrors the structure of `quote-email-template.ts` so admins recognise the look,
 * but tone + CTA are tailored for partner outreach.
 */

import type { CompanyBranding } from "@/lib/pdf/quote-template";

export interface PartnerUploadEmailOptions {
  partnerName: string;
  uploadUrl: string;
  expiresAt: Date;
  /** Optional admin-written message shown above the CTA. */
  customMessage?: string;
  /** Empty array → "any documents" wording; otherwise show the list. */
  requestedDocTypes?: string[];
}

const DOC_TYPE_LABELS: Record<string, string> = {
  insurance: "Insurance certificate",
  certification: "Trade certifications",
  license: "License",
  contract: "Signed contract",
  tax: "Tax / VAT documents",
  id_proof: "Photo ID",
  other: "Other documents",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function buildPartnerUploadEmailHTML(
  branding: CompanyBranding,
  options: PartnerUploadEmailOptions,
): string {
  const color = branding.primaryColor ?? "#F97316";
  const { partnerName, uploadUrl, expiresAt, customMessage, requestedDocTypes } = options;

  const docList = (requestedDocTypes ?? []).filter((t) => t && t.trim());
  const docListHtml = docList.length > 0
    ? `<ul style="margin:0 0 16px 20px;padding:0;font-size:14px;color:#1C1917;line-height:1.7;">
         ${docList.map((t) => `<li>${escapeHtml(DOC_TYPE_LABELS[t] ?? t)}</li>`).join("")}
       </ul>`
    : `<p style="margin:0 0 16px;font-size:14px;color:#57534E;line-height:1.6;">
         Please upload any current documents we have on file (insurance, ID, certifications) and
         confirm your contact and bank details so we can keep paying you on time.
       </p>`;

  const messageBlock = customMessage && customMessage.trim()
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid #E7E5E4;border-left:3px solid ${color};border-radius:8px;overflow:hidden;">
         <tr><td style="padding:12px 16px;background:#FAFAF9;">
           <p style="margin:0 0 4px;font-size:11px;color:#78716C;text-transform:uppercase;letter-spacing:0.5px;">Note from the team</p>
           <p style="margin:0;font-size:13px;color:#1C1917;line-height:1.5;white-space:pre-wrap;">${escapeHtml(customMessage.trim())}</p>
         </td></tr>
       </table>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F5F5F4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;">
    <tr><td style="height:4px;background:${color};"></td></tr>
    <tr><td style="padding:40px 40px 20px;">
      ${branding.logoUrl ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(branding.companyName)}" style="height:40px;margin-bottom:16px;" />` : ""}
      <h1 style="margin:0 0 4px;font-size:24px;color:${color};">${escapeHtml(branding.companyName)}</h1>
      ${branding.tagline ? `<p style="margin:0 0 20px;font-size:12px;color:#78716C;text-transform:uppercase;letter-spacing:1px;">${escapeHtml(branding.tagline)}</p>` : ""}
    </td></tr>
    <tr><td style="padding:0 40px 30px;">
      <p style="margin:0 0 8px;font-size:16px;color:#1C1917;">Hi <strong>${escapeHtml(partnerName)}</strong>,</p>
      <p style="margin:0 0 16px;font-size:14px;color:#57534E;line-height:1.6;">
        We need to refresh the documents and details we hold for you. Please use the secure link below
        to upload your files and confirm your contact / bank information — no login needed.
      </p>
      ${messageBlock}
      <p style="margin:0 0 8px;font-size:13px;color:#78716C;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">What we need</p>
      ${docListHtml}
      <table cellpadding="0" cellspacing="0" style="margin:8px auto 24px;">
        <tr><td style="background:${color};border-radius:8px;padding:14px 32px;">
          <a href="${uploadUrl}" style="color:#fff;text-decoration:none;font-size:14px;font-weight:600;">Open secure upload page</a>
        </td></tr>
      </table>
      <p style="margin:0 0 8px;font-size:12px;color:#78716C;text-align:center;">
        This link expires on <strong>${escapeHtml(formatDate(expiresAt))}</strong>.
      </p>
      <p style="margin:0;font-size:12px;color:#A8A29E;text-align:center;">
        If you didn't expect this email, you can safely ignore it.
      </p>
    </td></tr>
    <tr><td style="padding:20px 40px;background:#FAFAF9;border-top:1px solid #E7E5E4;">
      <p style="margin:0 0 4px;font-size:11px;color:#A8A29E;">${escapeHtml(branding.companyName)} — ${escapeHtml(branding.address)}</p>
      <p style="margin:0;font-size:11px;color:#A8A29E;">${escapeHtml(branding.phone)} — ${escapeHtml(branding.email)}</p>
    </td></tr>
  </table>
</body>
</html>`;
}
