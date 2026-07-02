/**
 * Shared layout for client-facing marketing/lifecycle emails (Resend-delivered).
 * Mirrors the partner email layout conventions:
 * - Absolute logo URL (email clients block relative paths)
 * - `color-scheme: light` to reduce Gmail/iOS dark-mode inversion
 * - Empty `<title>` so mobile clients don't inject the subject into the body
 * - Single 600px card on an off-white canvas, navy header band, orange accent
 *
 * Templates call `renderClientEmail(...)` and only supply the body content,
 * keeping each lifecycle email tiny.
 */

import { appBaseUrl } from "@/lib/app-base-url";

export const CLIENT_BRAND = {
  navy: "#020040",
  orange: "#ED4B00",
  orangeHover: "#D84300",
  canvas: "#F7F7FB",
  ink: "#0A0A1F",
  body: "#57534E",
  gray: "#78716C",
  line: "#E7E5E4",
  softOrangeBg: "#FFF8F4",
  softOrangeBorder: "#FED7AA",
} as const;

export function clientEmailHeaderBandUrl(): string {
  return `${appBaseUrl()}/logos/fixfy-email-header.png`;
}

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Hidden inbox preheader (the grey preview line next to the subject). */
function preheaderHtml(preheader: string): string {
  return `<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:${CLIENT_BRAND.canvas}; opacity:0;">${escapeHtml(preheader)}</div>`;
}

/** Primary CTA button (bulletproof for Outlook via padded anchor). */
export function clientCta(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;">
    <tr>
      <td class="btn-mobile" style="border-radius:8px; background:${CLIENT_BRAND.orange};">
        <a href="${escapeHtml(url)}" style="display:inline-block; padding:14px 30px; font-size:15px; font-weight:600; color:#FFFFFF; text-decoration:none;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

/** A bordered "trust" callout box (checklist of value props / reassurances). */
export function clientCallout(title: string, items: string[]): string {
  const rows = items
    .map(
      (i) =>
        `<tr><td style="padding:4px 0; font-size:14px; line-height:22px; color:#44403C;">&#10003;&nbsp; ${escapeHtml(i)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px; background:${CLIENT_BRAND.softOrangeBg}; border:1px solid ${CLIENT_BRAND.softOrangeBorder}; border-left:4px solid ${CLIENT_BRAND.orange}; border-radius:8px;">
    <tr><td style="padding:18px 20px;">
      <p style="margin:0 0 12px; font-size:16px; line-height:22px; color:${CLIENT_BRAND.navy}; font-weight:700;">${escapeHtml(title)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>
    </td></tr>
  </table>`;
}

/** A thin horizontal divider. */
export function clientDivider(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;"><tr><td style="border-top:1px solid ${CLIENT_BRAND.line}; font-size:0; line-height:0; height:1px;">&nbsp;</td></tr></table>`;
}

/** A standard body paragraph. */
export function clientP(html: string): string {
  return `<p style="margin:0 0 16px; font-size:15px; line-height:24px; color:${CLIENT_BRAND.body};">${html}</p>`;
}

export type RenderClientEmailInput = {
  /** Hidden inbox preview line. */
  preheader: string;
  /** Bold headline shown after "Hi {name}," */
  heading: string;
  /** Recipient first name (already trimmed); falls back to "there". */
  name?: string;
  /** Pre-built body HTML (use clientP / clientCallout / clientCta helpers). */
  bodyHtml: string;
  /** Small grey footer note above the brand line (optional). */
  footerNote?: string;
  /** Optional unsubscribe URL — adds an unsubscribe link to the footer. */
  unsubscribeUrl?: string;
};

export function renderClientEmail(input: RenderClientEmailInput): string {
  const name = input.name?.trim() ? escapeHtml(input.name.trim()) : "there";
  const headerBand = clientEmailHeaderBandUrl();
  const unsub = input.unsubscribeUrl
    ? ` &middot; <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:${CLIENT_BRAND.gray};">Unsubscribe</a>`
    : "";
  const footerNote = input.footerNote
    ? `<p style="margin:0 0 8px; font-size:12px; line-height:18px; color:${CLIENT_BRAND.gray};">${input.footerNote}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light" />
<title>&#8203;</title>
<style>
  :root { color-scheme: light only; supported-color-schemes: light; }
  body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; display: block; }
  body { margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: ${CLIENT_BRAND.canvas} !important; }
  a { color: ${CLIENT_BRAND.orange}; }
  @media screen and (max-width: 600px) {
    .container { width: 100% !important; }
    .px-mobile { padding-left: 24px !important; padding-right: 24px !important; }
    .h1-mobile { font-size: 24px !important; line-height: 32px !important; }
    .btn-mobile a { display: block !important; text-align:center; }
  }
</style>
</head>
<body bgcolor="${CLIENT_BRAND.canvas}" style="margin:0; padding:0; background-color:${CLIENT_BRAND.canvas}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
${preheaderHtml(input.preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CLIENT_BRAND.canvas}" style="background-color:${CLIENT_BRAND.canvas};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:600px; max-width:600px; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(2,0,64,0.08);">
      <tr>
        <td align="center" bgcolor="${CLIENT_BRAND.navy}" style="background:${CLIENT_BRAND.navy}; padding:24px;">
          <img src="${headerBand}" alt="Fixfy" width="120" height="auto" style="display:block; width:120px; height:auto;">
        </td>
      </tr>
      <tr><td style="background:${CLIENT_BRAND.orange}; line-height:5px; font-size:5px; height:5px;" height="5">&nbsp;</td></tr>
      <tr>
        <td class="px-mobile" style="padding:32px 28px;">
          <h1 class="h1-mobile" style="margin:0 0 6px; font-size:15px; line-height:22px; color:${CLIENT_BRAND.body}; font-weight:400;">Hi ${name},</h1>
          <p class="h1-mobile" style="margin:0 0 18px; font-size:26px; line-height:32px; color:${CLIENT_BRAND.navy}; font-weight:700; letter-spacing:-0.5px;">${escapeHtml(input.heading)}</p>
          ${input.bodyHtml}
        </td>
      </tr>
      <tr>
        <td class="px-mobile" style="padding:20px 28px; background:${CLIENT_BRAND.canvas}; border-top:1px solid ${CLIENT_BRAND.line};">
          ${footerNote}
          <p style="margin:0; font-size:12px; line-height:18px; color:${CLIENT_BRAND.gray};">
            Fixfy &middot; <a href="https://www.getfixfy.com" style="color:${CLIENT_BRAND.orange};">getfixfy.com</a>${unsub}
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
