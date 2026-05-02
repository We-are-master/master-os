/**
 * Quote-sent email body for Zendesk public comments.
 * Posted on the main ticket when a quote PDF is sent to the customer —
 * mirrors the Fixfy customer email template so the recipient sees the
 * same branded experience whether they read the Resend message or the
 * Zendesk thread reply.
 *
 * NOTE: layout uses <div> + float (NOT <table>). Zendesk applies its own
 * CSS to comment tables which paints visible borders around every cell —
 * see the "remove as linhas" bug fix.
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
  /** Line items — when provided, rendered as a breakdown inside the price card. */
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

/**
 * Strip whitespace BETWEEN tags only — text content inside <p>/<span>
 * stays untouched so user-supplied scope keeps its paragraph breaks.
 * Required because Zendesk renders the source's \n as visible breaks.
 */
function compactHtml(html: string): string {
  return html.replace(/>\s+</g, "><").trim();
}

/** Two-column row using floats — works without tables. */
function row(left: string, right: string, paddingY = "6px"): string {
  return `<div style="overflow:hidden;padding:${paddingY} 0;">` +
    `<div style="float:left;">${left}</div>` +
    `<div style="float:right;text-align:right;">${right}</div>` +
    `</div>`;
}

export function buildQuoteSentHtml(args: QuoteSentArgs): string {
  const fname      = escapeHtml(firstName(args.customerName) || "there");
  const ref        = escapeHtml(args.reference);
  const title      = escapeHtml(args.title);
  const address    = args.propertyAddress ? escapeHtml(args.propertyAddress) : "";
  const scope      = args.scope ? escapeHtml(args.scope) : "";
  const total      = escapeHtml(formatGbp(args.totalGbp));
  const validUntil = args.expiresAt ? escapeHtml(formatLongDate(args.expiresAt)) : "";

  // Header row of the price card: total on the left, "FIXED RATE" pill on the right
  const totalHeader =
    `<div style="overflow:hidden;">` +
      `<div style="float:left;">` +
        `<p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:rgba(255,255,255,0.64);">Total quote</p>` +
        `<p style="margin:0;font-size:32px;line-height:40px;font-weight:700;letter-spacing:-1px;color:#FFFFFF;">${total}</p>` +
      `</div>` +
      `<div style="float:right;">` +
        `<span style="display:inline-block;background:#ED4B00;color:#FFFFFF;padding:5px 11px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">Fixed rate</span>` +
      `</div>` +
    `</div>`;

  // Breakdown rows (no <table> — each row is a flex-like div)
  const breakdownRows = (args.items ?? [])
    .filter((it) => it && (it.description || it.total))
    .map((it) => {
      const labelText = `${escapeHtml(it.description || "Item")}${it.quantity > 1 ? ` × ${it.quantity}` : ""}`;
      const left  = `<span style="font-size:13px;color:rgba(255,255,255,0.64);">${labelText}</span>`;
      const right = `<span style="font-size:14px;font-weight:600;color:rgba(255,255,255,0.92);">${escapeHtml(formatGbp(Number(it.total) || 0))}</span>`;
      return row(left, right);
    })
    .join("");

  const breakdownBlock = breakdownRows
    ? `<div style="border-top:1px solid rgba(255,255,255,0.16);margin-top:16px;padding-top:8px;">${breakdownRows}</div>`
    : "";

  const validityBlock = validUntil
    ? `<div style="background:#FBEFD6;border-radius:8px;margin-top:16px;padding:14px 16px;">` +
        `<p style="margin:0;font-size:13px;line-height:20px;color:#7A4A00;">` +
          `<strong style="color:#C47A00;">⏱ This quote is valid until ${validUntil}.</strong> ` +
          `After that we may need to refresh the pricing, so it's best to approve it before then.` +
        `</p>` +
      `</div>`
    : "";

  const ctaButtons: string[] = [];
  if (args.acceptUrl) {
    ctaButtons.push(
      `<a href="${escapeHtml(args.acceptUrl)}" target="_blank" style="display:inline-block;padding:14px 28px;margin:0 4px 8px 0;background:#10B981;color:#FFFFFF;font-size:14px;font-weight:700;text-decoration:none;border-radius:8px;">Accept quote</a>`,
    );
  }
  if (args.rejectUrl) {
    ctaButtons.push(
      `<a href="${escapeHtml(args.rejectUrl)}" target="_blank" style="display:inline-block;padding:14px 28px;margin:0 0 8px 0;background:#FFFFFF;color:#3A3A55;font-size:14px;font-weight:700;text-decoration:none;border:1px solid #E4E4EC;border-radius:8px;">Decline</a>`,
    );
  }
  const ctaBlock = ctaButtons.length
    ? `<div style="margin-top:24px;text-align:center;">${ctaButtons.join("")}</div>`
    : "";

  const detailsBlocks: string[] = [];
  if (address) {
    detailsBlocks.push(
      `<div>` +
        `<p style="margin:0 0 4px;font-size:13px;color:#6B6B85;">Location</p>` +
        `<p style="margin:0;font-size:14px;line-height:21px;color:#3A3A55;">${address}</p>` +
      `</div>`,
    );
  }
  if (scope) {
    const sep = detailsBlocks.length ? "margin-top:14px;padding-top:14px;border-top:1px solid #E4E4EC;" : "";
    detailsBlocks.push(
      `<div style="${sep}">` +
        `<p style="margin:0 0 4px;font-size:13px;color:#6B6B85;">Scope of work</p>` +
        `<p style="margin:0;font-size:14px;line-height:21px;color:#3A3A55;white-space:pre-wrap;">${scope}</p>` +
      `</div>`,
    );
  }

  const detailsCard =
    `<div style="background:#F7F7FB;border:1px solid #E4E4EC;border-radius:10px;padding:22px;">` +
      `<p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#6B6B85;">Quote #${ref}</p>` +
      `<p style="margin:0 0 16px;font-size:17px;font-weight:600;">${title}</p>` +
      detailsBlocks.join("") +
    `</div>`;

  const html =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0A0A1F;max-width:600px;">` +
      `<h2 style="margin:0 0 12px;font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.3px;">Hi ${fname}, your quote is ready ✓</h2>` +
      `<p style="margin:0 0 20px;font-size:15px;line-height:23px;color:#3A3A55;">We've prepared a quote for the job you requested. Have a look at the details below — the PDF is attached to this message for your records.</p>` +
      `<div style="background:#020040;border-radius:10px;padding:22px;margin-bottom:16px;color:#fff;">` +
        totalHeader +
        breakdownBlock +
        `<p style="margin:14px 0 0;font-size:11px;line-height:16px;color:rgba(255,255,255,0.4);">All prices include VAT.</p>` +
      `</div>` +
      detailsCard +
      validityBlock +
      ctaBlock +
      `<p style="margin:24px 0 0;font-size:13px;line-height:20px;color:#6B6B85;">Got a question or want to talk through the proposal? Reply to this email and we'll get back to you.</p>` +
    `</div>`;

  return compactHtml(html);
}
