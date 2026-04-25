import type { QuotePDFData, CompanyBranding, QuoteLineItem } from "@/lib/pdf/quote-template";

export interface QuoteEmailOptions {
  acceptUrl?: string;
  rejectUrl?: string;
  customMessage?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Line items table + deposit + scope + notes for the email so the client can review the quote in detail. */
function buildQuoteDetailsSection(data: QuotePDFData, color: string): string {
  const items: QuoteLineItem[] =
    data.items?.length ? data.items : [{ description: data.title || "Services", quantity: 1, unitPrice: data.totalValue, total: data.totalValue }];
  const hasDeposit = (data.depositRequired ?? 0) > 0;
  const hasScope = typeof data.scope === "string" && data.scope.trim().length > 0;
  const hasNotes = typeof data.notes === "string" && data.notes.trim().length > 0;
  if (items.length === 0 && !hasDeposit && !hasScope && !hasNotes) return "";

  const rows = items
    .map(
      (row) =>
        `<tr>
          <td style="padding:12px 16px;border-bottom:1px solid #E7E5E4;font-size:13px;color:#1C1917;">${escapeHtml(row.description)}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #E7E5E4;font-size:13px;color:#57534E;text-align:center;">${row.quantity}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #E7E5E4;font-size:13px;color:#57534E;text-align:right;">£${Number(row.unitPrice).toLocaleString("en-GB", { minimumFractionDigits: 2 })}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #E7E5E4;font-size:13px;font-weight:600;color:#1C1917;text-align:right;">£${Number(row.total).toLocaleString("en-GB", { minimumFractionDigits: 2 })}</td>
        </tr>`,
    )
    .join("");

  const depositBlock = hasDeposit
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;border:1px solid #E7E5E4;border-radius:8px;overflow:hidden;">
        <tr style="background:#FFFBEB;"><td style="padding:12px 16px;font-size:13px;color:#92400E;">
          <strong>Deposit required:</strong> £${Number(data.depositRequired).toLocaleString("en-GB", { minimumFractionDigits: 2 })} (payable on acceptance)
        </td></tr>
      </table>`
    : "";

  const scopeBlock = hasScope
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;border:1px solid #E7E5E4;border-radius:8px;overflow:hidden;">
        <tr style="background:#FAFAF9;"><td style="padding:12px 16px;">
          <p style="margin:0 0 4px;font-size:11px;color:#78716C;text-transform:uppercase;letter-spacing:0.5px;">Scope of work</p>
          <p style="margin:0;font-size:13px;color:#1C1917;line-height:1.5;white-space:pre-wrap;">${escapeHtml(data.scope!.trim())}</p>
        </td></tr>
      </table>`
    : "";

  const notesBlock = hasNotes
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;border:1px solid #E7E5E4;border-left:3px solid ${color};border-radius:8px;overflow:hidden;">
        <tr><td style="padding:12px 16px;background:#FFFBEB;">
          <p style="margin:0 0 4px;font-size:11px;color:#92400E;text-transform:uppercase;letter-spacing:0.5px;">Notes</p>
          <p style="margin:0;font-size:13px;color:#57534E;line-height:1.5;white-space:pre-wrap;">${escapeHtml(data.notes!.trim())}</p>
        </td></tr>
      </table>`
    : "";

  return `
      <p style="margin:0 0 8px;font-size:12px;color:#78716C;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Quote details</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E7E5E4;border-radius:8px;overflow:hidden;margin-bottom:16px;">
        <tr style="background:#1C1917;">
          <td style="padding:10px 16px;font-size:11px;font-weight:600;color:#fff;text-transform:uppercase;">Description</td>
          <td style="padding:10px 16px;font-size:11px;font-weight:600;color:#fff;text-transform:uppercase;text-align:center;width:60px;">Qty</td>
          <td style="padding:10px 16px;font-size:11px;font-weight:600;color:#fff;text-transform:uppercase;text-align:right;width:80px;">Unit price</td>
          <td style="padding:10px 16px;font-size:11px;font-weight:600;color:#fff;text-transform:uppercase;text-align:right;width:90px;">Total</td>
        </tr>
        ${rows}
      </table>
      ${depositBlock}
      ${scopeBlock}
      ${notesBlock}`;
}

/**
 * Builds the HTML body for the quote email (Resend).
 * Used by send-pdf and email-preview API.
 */
export function buildQuoteEmailHTML(
  data: QuotePDFData,
  branding: CompanyBranding,
  options?: QuoteEmailOptions,
): string {
  const { acceptUrl, rejectUrl, customMessage } = options ?? {};
  const color = branding.primaryColor ?? "#F97316";
  const hasResponseLinks = acceptUrl && rejectUrl;
  const buttons = hasResponseLinks
    ? `
      ${customMessage ? `<p style="margin:0 0 16px;font-size:14px;color:#57534E;line-height:1.6;">${escapeHtml(customMessage)}</p>` : ""}
      <p style="margin:0 0 12px;font-size:14px;color:#57534E;">You can respond directly below:</p>
      <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
        <tr>
          <td style="padding:0 8px 0 0;">
            <a href="${acceptUrl}" style="display:inline-block;background:#16A34A;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:14px 28px;border-radius:8px;">Accept quote</a>
          </td>
          <td>
            <a href="${rejectUrl}" style="display:inline-block;background:#DC2626;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:14px 28px;border-radius:8px;">Reject quote</a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 24px;font-size:12px;color:#78716C;">If you accept, we will confirm next steps. If you reject, you can optionally provide a reason.</p>`
    : `
      ${customMessage ? `<p style="margin:0 0 16px;font-size:14px;color:#57534E;line-height:1.6;">${escapeHtml(customMessage)}</p>` : ""}
      <p style="margin:0 0 24px;font-size:14px;color:#57534E;">If you have any questions or would like to proceed, reply to this email.</p>
      <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
        <tr><td style="background:${color};border-radius:8px;padding:14px 32px;">
          <a href="mailto:${branding.email}?subject=Re: ${escapeHtml(data.reference)}" style="color:#fff;text-decoration:none;font-size:14px;font-weight:600;">Reply to this email</a>
        </td></tr>
      </table>`;

  return `
<!DOCTYPE html>
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
      <p style="margin:0 0 8px;font-size:16px;color:#1C1917;">Dear <strong>${escapeHtml(data.clientName)}</strong>,</p>
      <p style="margin:0 0 20px;font-size:14px;color:#57534E;line-height:1.6;">
        Thank you for your interest. Please find attached our quotation <strong>${escapeHtml(data.reference)}</strong> for the following:
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E7E5E4;border-radius:8px;overflow:hidden;margin-bottom:20px;">
        <tr style="background:#FAFAF9;">
          <td style="padding:16px;border-bottom:1px solid #E7E5E4;">
            <p style="margin:0 0 4px;font-size:12px;color:#78716C;">Service</p>
            <p style="margin:0;font-size:15px;font-weight:600;color:#1C1917;">${escapeHtml(data.title)}</p>
          </td>
          <td style="padding:16px;border-bottom:1px solid #E7E5E4;text-align:right;">
            <p style="margin:0 0 4px;font-size:12px;color:#78716C;">Quoted Value <span style="display:inline-block;padding:1px 4px;border-radius:3px;background:#DCFCE7;color:#166534;font-size:10px;font-weight:700;letter-spacing:0.3px;">INC VAT</span></p>
            <p style="margin:0;font-size:20px;font-weight:700;color:${color};">£${data.totalValue.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</p>
          </td>
        </tr>
        <tr>
          <td colspan="2" style="padding:16px;">
            <p style="margin:0;font-size:12px;color:#78716C;">
              Reference: <strong>${escapeHtml(data.reference)}</strong>
              ${data.expiresAt ? ` — Valid until: <strong>${new Date(data.expiresAt).toLocaleDateString("en-GB")}</strong>` : ""}
            </p>
          </td>
        </tr>
      </table>
      ${buildQuoteDetailsSection(data, color)}
      <p style="margin:0 0 16px;font-size:14px;color:#57534E;line-height:1.6;">
        A PDF copy of this quote is also attached.
      </p>
      ${buttons}
    </td></tr>
    <tr><td style="padding:20px 40px;background:#FAFAF9;border-top:1px solid #E7E5E4;">
      <p style="margin:0 0 4px;font-size:11px;color:#A8A29E;">${escapeHtml(branding.companyName)} — ${escapeHtml(branding.address)}</p>
      <p style="margin:0;font-size:11px;color:#A8A29E;">${escapeHtml(branding.phone)} — ${escapeHtml(branding.email)}</p>
    </td></tr>
  </table>
</body>
</html>`;
}
