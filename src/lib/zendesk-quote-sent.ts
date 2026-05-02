/**
 * Quote-sent email body for Zendesk public comments.
 * Posted on the main ticket when a quote PDF is sent to the customer —
 * mirrors the Fixfy customer email template so the recipient sees the
 * same branded experience whether they read the Resend message or the
 * Zendesk thread reply.
 */

interface QuoteLineItem {
  description: string;
  quantity:    number;
  unitPrice:   number;
  total:       number;
}

interface QuoteSentArgs {
  customerName:    string;
  reference:       string;
  title:           string;
  propertyAddress: string | null;
  scope:           string | null;
  totalGbp:        number;
  /** ISO timestamp; when present, drives the "valid until …" notice. */
  expiresAt:       string | null;
  /** Line items — when provided, rendered as a breakdown table inside the price card. */
  items?:          QuoteLineItem[];
  /** Tokenised accept/reject links — when provided, rendered as CTA buttons. */
  acceptUrl?:      string;
  rejectUrl?:      string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstName(full: string): string {
  return (full.trim().split(/\s+/)[0] ?? "").trim();
}

function formatLongDate(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day:    "numeric",
    month:  "long",
    year:   "numeric",
  }).format(dt);
}

function formatGbp(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style:    "currency",
    currency: "GBP",
  }).format(value);
}

export function buildQuoteSentHtml(args: QuoteSentArgs): string {
  const fname    = escapeHtml(firstName(args.customerName) || "there");
  const ref      = escapeHtml(args.reference);
  const title    = escapeHtml(args.title);
  const address  = args.propertyAddress ? escapeHtml(args.propertyAddress) : "";
  const scope    = args.scope ? escapeHtml(args.scope) : "";
  const total    = escapeHtml(formatGbp(args.totalGbp));
  const validUntil = args.expiresAt ? escapeHtml(formatLongDate(args.expiresAt)) : "";

  const breakdownRows = (args.items ?? [])
    .filter((it) => it && (it.description || it.total))
    .map((it) => `
        <tr>
          <td style="padding:6px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:rgba(255,255,255,0.64);">
            ${escapeHtml(it.description || "Item")}${it.quantity > 1 ? ` × ${it.quantity}` : ""}
          </td>
          <td align="right" style="padding:6px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:rgba(255,255,255,0.92);">
            ${escapeHtml(formatGbp(Number(it.total) || 0))}
          </td>
        </tr>`)
    .join("");

  const breakdownBlock = breakdownRows ? `
        <div style="border-top:1px solid rgba(255,255,255,0.16);margin:18px 0 14px 0;height:1px;line-height:1px;font-size:1px;">&nbsp;</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${breakdownRows}
        </table>` : "";

  const validityBlock = validUntil ? `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FBEFD6;border-radius:8px;margin-top:16px;">
    <tr>
      <td style="padding:14px 16px;">
        <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#7A4A00;">
          <strong style="color:#C47A00;">⏱ This quote is valid until ${validUntil}.</strong>
          After that we may need to refresh the pricing, so it's best to approve it before then.
        </p>
      </td>
    </tr>
  </table>` : "";

  const ctaBlock = args.acceptUrl || args.rejectUrl ? `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
    <tr>
      ${args.acceptUrl ? `
      <td align="center" style="padding-right:6px;">
        <a href="${escapeHtml(args.acceptUrl)}" target="_blank" style="display:inline-block;padding:14px 28px;background:#10B981;color:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;border-radius:8px;">
          Accept quote
        </a>
      </td>` : ""}
      ${args.rejectUrl ? `
      <td align="center" style="padding-left:6px;">
        <a href="${escapeHtml(args.rejectUrl)}" target="_blank" style="display:inline-block;padding:14px 28px;background:#FFFFFF;color:#3A3A55;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;border-radius:8px;border:1px solid #E4E4EC;">
          Decline
        </a>
      </td>` : ""}
    </tr>
  </table>` : "";

  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0A0A1F;max-width:600px;">
  <h2 style="margin:0 0 12px;font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.3px;">
    Hi ${fname}, your quote is ready ✓
  </h2>
  <p style="margin:0 0 20px;font-size:15px;line-height:23px;color:#3A3A55;">
    We've prepared a quote for the job you requested. Have a look at the details below — the PDF is attached to this message for your records.
  </p>

  <div style="background:#020040;border-radius:10px;padding:22px;margin-bottom:16px;color:#fff;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td>
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:rgba(255,255,255,0.64);">
            Total quote
          </p>
          <p style="margin:0;font-size:32px;line-height:40px;font-weight:700;letter-spacing:-1px;">
            ${total}
          </p>
        </td>
        <td align="right" valign="top">
          <span style="display:inline-block;background:#ED4B00;color:#FFFFFF;padding:5px 11px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">
            Fixed rate
          </span>
        </td>
      </tr>
    </table>
    ${breakdownBlock}
    <p style="margin:14px 0 0;font-size:11px;line-height:16px;color:rgba(255,255,255,0.4);">
      All prices include VAT.
    </p>
  </div>

  <div style="background:#F7F7FB;border:1px solid #E4E4EC;border-radius:10px;padding:22px;">
    <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#6B6B85;">
      Quote #${ref}
    </p>
    <p style="margin:0 0 16px;font-size:17px;font-weight:600;">${title}</p>

    ${address ? `
    <div>
      <p style="margin:0 0 4px;font-size:13px;color:#6B6B85;">Location</p>
      <p style="margin:0;font-size:14px;line-height:21px;color:#3A3A55;">${address}</p>
    </div>` : ""}

    ${scope ? `
    <div style="${address ? "margin-top:14px;padding-top:14px;border-top:1px solid #E4E4EC;" : ""}">
      <p style="margin:0 0 4px;font-size:13px;color:#6B6B85;">Scope of work</p>
      <p style="margin:0;font-size:14px;line-height:21px;color:#3A3A55;white-space:pre-wrap;">${scope}</p>
    </div>` : ""}
  </div>

  ${validityBlock}
  ${ctaBlock}

  <p style="margin:24px 0 0;font-size:13px;line-height:20px;color:#6B6B85;">
    Got a question or want to talk through the proposal? Reply to this email and we'll get back to you.
  </p>
</div>
  `.trim();
}
