/**
 * Shared layout helpers for partner-facing transactional emails (Zendesk side conv).
 * - Absolute logo URL (email clients block relative paths)
 * - `color-scheme: light` to reduce Gmail/iOS dark-mode inversion
 * - Empty `<title>` so mobile clients don't inject the subject (or a brand name) into the body
 */

import { appBaseUrl } from "@/lib/app-base-url";

/** White wordmark (transparent) — legacy / footer strips. */
export function partnerEmailLogoUrl(): string {
  return `${appBaseUrl()}/logos/fixfy-wordmark.png`;
}

/**
 * Full-width header band (navy + white logo baked in) — survives Gmail/iOS dark-mode
 * inversion better than transparent wordmark on a separate bgcolor cell.
 */
export function partnerEmailHeaderBandUrl(): string {
  return `${appBaseUrl()}/logos/fixfy-email-header.png`;
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Inbox preheader (hidden). Keep subject out of `<title>`. */
export function partnerEmailPreheaderHtml(preheader: string): string {
  const safe = escapeHtml(preheader);
  return `<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#F7F7FB; opacity:0;">${safe}</div>`;
}

export function partnerEmailHeadBlock(): string {
  return `<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light" />
<title>&#8203;</title>`;
}

export function partnerEmailBaseStyles(extra = ""): string {
  return `<style>
  :root { color-scheme: light only; supported-color-schemes: light; }
  body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; display: block; }
  body { margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #F7F7FB !important; }
  a { color: #ED4B00; text-decoration: underline; }
  @media (prefers-color-scheme: dark) {
    body, .email-bg { background-color: #F7F7FB !important; }
    .email-card { background-color: #FFFFFF !important; }
    .partner-email-header-td { background-color: #020040 !important; }
    .partner-email-header-img { filter: none !important; opacity: 1 !important; }
  }
  @media screen and (max-width: 600px) {
    .container { width: 100% !important; }
    .px-mobile { padding-left: 24px !important; padding-right: 24px !important; }
    .h1-mobile { font-size: 24px !important; line-height: 32px !important; }
    .info-row td { display: block !important; width: 100% !important; padding: 4px 0 !important; }
    .info-label { padding-bottom: 2px !important; }
    .btn-mobile a { display: block !important; }
    .price-mobile { font-size: 32px !important; }
  }
  ${extra}
</style>`;
}

/** Navy header band — single image (logo + background) for legibility on mobile Gmail. */
export function partnerEmailLogoHeaderRow(_padding = "32px 40px"): string {
  const band = escapeHtml(partnerEmailHeaderBandUrl());
  return `      <tr><td align="center" bgcolor="#020040" class="partner-email-header-td px-mobile" style="background-color:#020040 !important; background-image:linear-gradient(#020040,#020040); padding:0; line-height:0; font-size:0; mso-line-height-rule:exactly;">
        <!--[if mso]>
        <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;height:88px;">
          <v:fill type="tile" color="#020040" />
          <v:textbox inset="0,0,0,0" style="mso-fit-shape-to-text:true">
        <![endif]-->
        <div style="background-color:#020040; background-image:linear-gradient(#020040,#020040); max-height:88px; overflow:hidden;">
          <img src="${band}" alt="Fixfy" width="600" class="partner-email-header-img" style="display:block; width:100%; max-width:600px; height:auto; margin:0 auto; border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; color:#020040;" />
        </div>
        <!--[if mso]></v:textbox></v:rect><![endif]-->
      </td></tr>`;
}

export function partnerEmailOuterTableOpen(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" bgcolor="#F7F7FB" style="background-color:#F7F7FB;">
  <tr><td align="center" style="padding: 32px 16px;">
    <table role="presentation" class="container email-card" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:600px; max-width:600px; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(2,0,64,0.08);">`;
}

export function partnerEmailOuterTableClose(): string {
  return `    </table>
  </td></tr>
</table>`;
}

export function partnerEmailBodyOpen(): string {
  return `<body class="email-bg" bgcolor="#F7F7FB" style="margin:0; padding:0; background-color:#F7F7FB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">`;
}

const PARTNER_EMAIL_TITLE_FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function partnerEmailTitleInlineStyle(fontSize: string, lineHeight: string): string {
  return `font-family:${PARTNER_EMAIL_TITLE_FONT}; font-size:${fontSize}; line-height:${lineHeight}; font-weight:700; color:#0A0A1F; letter-spacing:-0.5px`;
}

/** Greeting only — e.g. "Hi Victor," on its own line. */
export function partnerEmailGreetingH1Html(
  nameEsc: string,
  opts?: { marginBottom?: string; fontSize?: string; lineHeight?: string },
): string {
  const mb = opts?.marginBottom ?? "8px";
  const fs = opts?.fontSize ?? "28px";
  const lh = opts?.lineHeight ?? "36px";
  return `<h1 class="h1-mobile" style="margin:0 0 ${mb} 0; ${partnerEmailTitleInlineStyle(fs, lh)};">Hi ${nameEsc},</h1>`;
}

/** Bold headline after the greeting (same visual weight as the h1). */
export function partnerEmailHeadlineAfterGreetingHtml(
  headlineEsc: string,
  opts?: { marginBottom?: string; fontSize?: string; lineHeight?: string },
): string {
  const mb = opts?.marginBottom ?? "12px";
  const fs = opts?.fontSize ?? "28px";
  const lh = opts?.lineHeight ?? "36px";
  return `<p class="h1-mobile" style="margin:0 0 ${mb} 0; ${partnerEmailTitleInlineStyle(fs, lh)};">${headlineEsc}</p>`;
}

/** Two-line title: greeting, then headline. */
export function partnerEmailSplitTitleHtml(
  nameEsc: string,
  headlineEsc: string,
  opts?: { marginBottomAfterHeadline?: string; fontSize?: string; lineHeight?: string },
): string {
  return (
    partnerEmailGreetingH1Html(nameEsc, {
      marginBottom: "8px",
      fontSize: opts?.fontSize,
      lineHeight: opts?.lineHeight,
    }) +
    partnerEmailHeadlineAfterGreetingHtml(headlineEsc, {
      marginBottom: opts?.marginBottomAfterHeadline ?? "12px",
      fontSize: opts?.fontSize,
      lineHeight: opts?.lineHeight,
    })
  );
}
