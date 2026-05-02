/**
 * Booking confirmation email body for Zendesk public comments.
 * Posted on the main ticket when a job is created from a Zendesk-linked
 * request — so the customer receives a confirmation through the same
 * ticket thread they originally opened.
 */

interface BookingArgs {
  customerName:    string;
  reference:       string;
  title:           string;
  propertyAddress: string;
  scope:           string | null;
  scheduledDate:   string;       // YYYY-MM-DD
  scheduledHour:   string;       // HH:MM
  totalGbp:        number;
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

/** Format YYYY-MM-DD as "Saturday, 3 May 2026" using en-GB locale. */
function formatLongDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map((n) => Number(n));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day:     "numeric",
    month:   "long",
    year:    "numeric",
    timeZone: "UTC",
  }).format(dt);
}

function formatGbp(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style:    "currency",
    currency: "GBP",
  }).format(value);
}

/**
 * Zendesk renders \n as visible line breaks inside ticket comments.
 * Strip whitespace BETWEEN tags only — text content inside <p>/<td> stays
 * untouched so user-supplied scope keeps its paragraph breaks.
 */
function compactHtml(html: string): string {
  return html.replace(/>\s+</g, "><").trim();
}

export function buildJobConfirmationHtml(args: BookingArgs): string {
  const fname     = escapeHtml(firstName(args.customerName) || "there");
  const dateLong  = escapeHtml(formatLongDate(args.scheduledDate));
  const time      = escapeHtml(args.scheduledHour);
  const ref       = escapeHtml(args.reference);
  const title     = escapeHtml(args.title);
  const address   = escapeHtml(args.propertyAddress);
  const scope     = args.scope ? escapeHtml(args.scope) : "";
  const total     = escapeHtml(formatGbp(args.totalGbp));

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0A0A1F;max-width:600px;">
  <h2 style="margin:0 0 12px;font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.3px;">
    Hi ${fname}, your booking is confirmed ✓
  </h2>
  <p style="margin:0 0 20px;font-size:15px;line-height:23px;color:#3A3A55;">
    Your job is all set. Here are the details — please save this email for reference.
  </p>

  <div style="background:#E4F4EC;border-radius:10px;padding:18px 22px;margin-bottom:16px;">
    <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#0E8A5F;">
      📅 Scheduled for
    </p>
    <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:#0A5A3F;">
      ${dateLong}
    </p>
    <p style="margin:0;font-size:14px;color:#0A5A3F;">${time}</p>
  </div>

  <div style="background:#020040;border-radius:10px;padding:20px 22px;margin-bottom:16px;color:#fff;">
    <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:rgba(255,255,255,0.64);">
      Approved total
    </p>
    <p style="margin:0;font-size:30px;font-weight:700;letter-spacing:-1px;">${total}</p>
    <p style="margin:10px 0 0;font-size:11px;color:rgba(255,255,255,0.4);">Includes VAT.</p>
  </div>

  <div style="background:#F7F7FB;border:1px solid #E4E4EC;border-radius:10px;padding:20px 22px;margin-bottom:16px;">
    <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#6B6B85;">
      Booking #${ref}
    </p>
    <p style="margin:0 0 14px;font-size:17px;font-weight:600;">${title}</p>

    <div style="display:inline-block;background:#E4F4EC;color:#0E8A5F;padding:5px 11px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">
      ✓ Confirmed
    </div>

    <div style="margin-top:16px;padding-top:16px;border-top:1px solid #E4E4EC;">
      <p style="margin:0 0 4px;font-size:13px;color:#6B6B85;">Location</p>
      <p style="margin:0;font-size:14px;line-height:21px;color:#3A3A55;">${address}</p>
    </div>

    ${scope ? `
    <div style="margin-top:14px;padding-top:14px;border-top:1px solid #E4E4EC;">
      <p style="margin:0 0 4px;font-size:13px;color:#6B6B85;">Scope of work</p>
      <p style="margin:0;font-size:14px;line-height:21px;color:#3A3A55;white-space:pre-wrap;">${scope}</p>
    </div>` : ""}
  </div>

  <p style="margin:0;font-size:13px;line-height:20px;color:#6B6B85;">
    Need to reschedule or change anything? Just reply to this email and we'll sort it out.
  </p>
</div>
  `;

  return compactHtml(html);
}
