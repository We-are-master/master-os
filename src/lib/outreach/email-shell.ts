/**
 * Wraps the staff-composed HTML body (from TipTap) in a branded envelope
 * matching the look of partner-upload/quote emails. Header stripe + logo +
 * footer with company address/contact.
 *
 * The inner body_html is trusted (it comes from the admin composer, not from
 * user input on a public form). We do NOT sanitize — TipTap emits a safe
 * subset already, and the content is only ever delivered to recipients we
 * chose.
 */

import type { CompanyBranding } from "@/lib/pdf/quote-template";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export interface OutreachShellOptions {
  bodyHtml: string;
  branding: CompanyBranding;
  /** When set, shown as a grey preheader chip (e.g. "Sent by Fixfy OS"). */
  preheader?: string;
}

export function wrapOutreachHtml({ bodyHtml, branding, preheader }: OutreachShellOptions): string {
  const color = branding.primaryColor ?? "#F97316";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F5F5F4;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>` : ""}
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;">
    <tr><td style="height:4px;background:${color};"></td></tr>
    <tr><td style="padding:32px 40px 8px;">
      ${branding.logoUrl ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(branding.companyName)}" style="height:36px;margin-bottom:12px;" />` : ""}
      <h1 style="margin:0;font-size:20px;color:${color};font-weight:600;">${escapeHtml(branding.companyName)}</h1>
      ${branding.tagline ? `<p style="margin:4px 0 0;font-size:11px;color:#78716C;text-transform:uppercase;letter-spacing:1px;">${escapeHtml(branding.tagline)}</p>` : ""}
    </td></tr>
    <tr><td style="padding:16px 40px 28px;">
      <div style="font-size:14px;line-height:1.6;color:#1C1917;">${bodyHtml}</div>
    </td></tr>
    <tr><td style="padding:20px 40px;background:#FAFAF9;border-top:1px solid #E7E5E4;">
      <p style="margin:0 0 4px;font-size:11px;color:#A8A29E;">${escapeHtml(branding.companyName)} — ${escapeHtml(branding.address)}</p>
      <p style="margin:0;font-size:11px;color:#A8A29E;">${escapeHtml(branding.phone)} — ${escapeHtml(branding.email)}</p>
    </td></tr>
  </table>
</body>
</html>`;
}

export const DEFAULT_BRANDING: CompanyBranding = {
  companyName: "Fixfy",
  address: "124 City Road, London, UK",
  phone: "+44 20 1234 5678",
  email: "support@getfixfy.com",
  primaryColor: "#F97316",
  tagline: "Professional Property Services",
};
