/**
 * Client booking confirmation email for Zendesk public comments.
 * Posted on the main ticket when a job is booked (status = scheduled).
 */

import { formatArrivalTimeRange, formatHourMinuteAmPm } from "@/lib/schedule-calendar";
import { extractUkPostcode } from "@/lib/uk-postcode";

const FIXFY_LOGO_URL = "https://www.getfixfy.com/brand/fixfy-primary-white.png";

export interface JobConfirmationEmailArgs {
  /** Organization name when linked; otherwise client first name. */
  greetingName: string;
  jobReference: string;
  jobTitle: string;
  jobDate: string;
  arrivalWindow: string;
  propertyAddress: string;
  propertyPostcode: string;
  typeOfWork: string;
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstName(full: string): string {
  return (full.trim().split(/\s+/)[0] ?? "").trim();
}

/** Organization name wins; otherwise the client's first name. */
export function resolveCustomerGreetingName(
  organizationName: string | null | undefined,
  clientDisplayName: string,
): string {
  const org = organizationName?.trim();
  if (org) return org;
  return firstName(clientDisplayName) || "there";
}

/** Format YYYY-MM-DD as "11 Jun" — same short date as partner job email subjects. */
export function formatJobConfirmationLongDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map((n) => Number(n));
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(dt);
}

export function formatJobConfirmationArrivalWindow(args: {
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
}): string {
  if (args.scheduled_start_at && args.scheduled_end_at) {
    return formatArrivalTimeRange(args.scheduled_start_at, args.scheduled_end_at) ?? "To be confirmed";
  }
  if (args.scheduled_start_at) {
    const dt = new Date(args.scheduled_start_at);
    if (!Number.isNaN(dt.getTime())) return formatHourMinuteAmPm(dt);
  }
  return "To be confirmed";
}

export function splitPropertyAddressAndPostcode(full: string): {
  propertyAddress: string;
  propertyPostcode: string;
} {
  const raw = full.trim();
  const postcode = extractUkPostcode(raw);
  if (!postcode) return { propertyAddress: raw || "—", propertyPostcode: "" };
  const address = raw
    .replace(new RegExp(postcode.replace(/\s+/g, "\\s*"), "i"), "")
    .replace(/,\s*$/, "")
    .trim();
  return {
    propertyAddress: address || raw,
    propertyPostcode: postcode,
  };
}

function compactHtml(html: string): string {
  return html.replace(/>\s+</g, "><").trim();
}

export function buildJobConfirmationHtml(args: JobConfirmationEmailArgs): string {
  const greeting = escapeHtml(args.greetingName || "there");
  const ref = escapeHtml(args.jobReference);
  const title = escapeHtml(args.jobTitle);
  const date = escapeHtml(args.jobDate);
  const window = escapeHtml(args.arrivalWindow);
  const address = escapeHtml(args.propertyAddress);
  const postcode = escapeHtml(args.propertyPostcode);
  const service = escapeHtml(args.typeOfWork);
  const preheader = escapeHtml(`Your job is confirmed for ${args.jobDate} between ${args.arrivalWindow}.`);
  const logo = escapeHtml(FIXFY_LOGO_URL);

  const postcodeLine = postcode
    ? `<br><span style="color:#4A4A55;">${postcode}</span>`
    : "";

  const html = `
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F5F5F7;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(2,0,64,0.06);">
<tr><td align="center" bgcolor="#020040" style="background:#020040;padding:24px 24px 18px 24px;"><img src="${logo}" alt="Fixfy" width="100" style="display:block;width:100px;height:auto;border:0;"></td></tr>
<tr><td style="background:#ED4B00;line-height:5px;font-size:5px;height:5px;" height="5">&nbsp;</td></tr>
<tr><td style="padding:32px 40px 8px 40px;"><p style="margin:0;font-size:11px;font-weight:700;letter-spacing:3px;color:#ED4B00;text-transform:uppercase;">✓ JOB CONFIRMED</p></td></tr>
<tr><td style="padding:0 40px 8px 40px;"><h1 style="margin:0;font-size:26px;line-height:32px;font-weight:700;color:#020040;">Hi ${greeting},</h1></td></tr>
<tr><td style="padding:0 40px 28px 40px;"><p style="margin:0;font-size:15px;line-height:24px;color:#4A4A55;">Good news — your job is confirmed and scheduled. Here are the details:</p></td></tr>
<tr><td style="padding:0 40px 28px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E8E8EE;border-radius:8px;">
<tr><td style="padding:18px 20px 14px 20px;border-bottom:1px solid #E8E8EE;">
<p style="margin:0 0 4px 0;font-size:12px;color:#9A9AA8;">Job #${ref}</p>
<p style="margin:0;font-size:18px;font-weight:700;color:#020040;line-height:24px;">${title}</p>
</td></tr>
<tr><td style="padding:14px 20px;border-top:1px solid #F2F0FA;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="38%" valign="top" style="padding:0 12px 0 0;font-size:12px;font-weight:700;color:#9A9AA8;text-transform:uppercase;letter-spacing:1px;">Date</td>
<td valign="top" style="font-size:15px;color:#020040;font-weight:600;">${date}</td>
</tr></table>
</td></tr>
<tr><td style="padding:14px 20px;border-top:1px solid #F2F0FA;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="38%" valign="top" style="padding:0 12px 0 0;font-size:12px;font-weight:700;color:#9A9AA8;text-transform:uppercase;letter-spacing:1px;">Arrival window</td>
<td valign="top" style="font-size:15px;color:#020040;font-weight:600;">${window}</td>
</tr></table>
</td></tr>
<tr><td style="padding:14px 20px;border-top:1px solid #F2F0FA;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="38%" valign="top" style="padding:0 12px 0 0;font-size:12px;font-weight:700;color:#9A9AA8;text-transform:uppercase;letter-spacing:1px;">Address</td>
<td valign="top" style="font-size:14px;color:#1A1A1A;line-height:20px;">${address}${postcodeLine}</td>
</tr></table>
</td></tr>
<tr><td style="padding:14px 20px 16px 20px;border-top:1px solid #F2F0FA;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="38%" valign="top" style="padding:0 12px 0 0;font-size:12px;font-weight:700;color:#9A9AA8;text-transform:uppercase;letter-spacing:1px;">Service</td>
<td valign="top" style="font-size:14px;color:#1A1A1A;">${service}</td>
</tr></table>
</td></tr>
</table>
</td></tr>
<tr><td style="padding:0 40px 8px 40px;"><p style="margin:0 0 12px 0;font-size:11px;font-weight:700;letter-spacing:2px;color:#020040;text-transform:uppercase;">WHAT HAPPENS NEXT</p></td></tr>
<tr><td style="padding:0 40px 28px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F0FA;border-radius:8px;"><tr><td style="padding:18px 20px;">
<p style="margin:0 0 10px 0;font-size:14px;line-height:22px;color:#020040;"><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;background:#ED4B00;color:#fff;border-radius:50%;font-size:12px;font-weight:700;margin-right:8px;">1</span>A vetted Fixfy professional has been assigned to your job.</p>
<p style="margin:0 0 10px 0;font-size:14px;line-height:22px;color:#020040;"><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;background:#ED4B00;color:#fff;border-radius:50%;font-size:12px;font-weight:700;margin-right:8px;">2</span>They will arrive within the window above on the scheduled date.</p>
<p style="margin:0;font-size:14px;line-height:22px;color:#020040;"><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;background:#ED4B00;color:#fff;border-radius:50%;font-size:12px;font-weight:700;margin-right:8px;">3</span>Once the work is complete, you'll receive a report by email.</p>
</td></tr></table>
</td></tr>
<tr><td align="center" style="padding:0 40px 28px 40px;"><p style="margin:0;font-size:13px;color:#4A4A55;">Need to reschedule? Reply to this email and we'll sort it out.</p></td></tr>
<tr><td style="padding:0 40px 32px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F0FA;border-radius:8px;"><tr><td style="padding:14px 18px;">
<p style="margin:0 0 4px 0;font-size:12px;font-weight:700;color:#020040;">Questions?</p>
<p style="margin:0;font-size:13px;line-height:20px;color:#4A4A55;">Reply to this email or message us at <a href="mailto:support@getfixfy.com" style="color:#020040;font-weight:600;text-decoration:none;">support@getfixfy.com</a> &middot; <a href="tel:+442045384668" style="color:#020040;font-weight:600;text-decoration:none;">020 4538 4668</a></p>
</td></tr></table>
</td></tr>
<tr><td bgcolor="#020040" style="background:#020040;padding:24px 40px;text-align:center;">
<img src="${logo}" alt="Fixfy" width="70" style="display:inline-block;width:70px;height:auto;margin-bottom:10px;border:0;">
<p style="margin:0;font-size:11px;line-height:18px;color:#AAAAD0;">Getfixfy Ltd &middot; Co. No. 15406523<br>124 City Road, London EC1V 2NX, United Kingdom<br><a href="https://getfixfy.com" style="color:#AAAAD0;text-decoration:none;">getfixfy.com</a></p>
</td></tr>
</table>
</td></tr>
</table>
  `;

  return compactHtml(html);
}
