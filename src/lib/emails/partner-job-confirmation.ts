/**
 * Partner job assignment / confirmation email.
 *
 * Sent via Zendesk Side Conversation when a job is assigned to a partner
 * and the originating ticket has a `zendesk_ticket_id` set.
 *
 * Layout, copy and styling mirror the design at
 * job-allocation-partner-PREVIEW.html — only the dynamic fields below
 * change per job.
 */

export interface PartnerJobConfirmationData {
  partnerFirstName: string;
  jobReference: string;
  jobTitle: string;
  clientName: string;
  clientPhone?: string | null;
  propertyAddress: string;
  scope: string;
  /** Either "Hourly" or "Fixed" — drives the price-pill copy. */
  jobType: "hourly" | "fixed";
  /** £ display value (e.g. "£45.00/hr" or "£280.00"). */
  priceDisplay: string;
  /** Where the partner submits the report — typically the partner app deep link. */
  reportUrl: string;
  /** Support email (defaults to support@getfixfy.com). */
  supportEmail?: string;
  /** Support phone (defaults to +44 20 4538 4668). */
  supportPhone?: string;
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function telHref(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

export function buildPartnerJobConfirmationEmail(data: PartnerJobConfirmationData): {
  subject: string;
  html: string;
  text: string;
} {
  const supportEmail = data.supportEmail ?? "support@getfixfy.com";
  const supportPhone = data.supportPhone ?? "+44 20 4538 4668";
  const subject = `Job booked — ${data.jobReference}`;

  const safe = {
    name: escapeHtml(data.partnerFirstName || "there"),
    ref: escapeHtml(data.jobReference),
    title: escapeHtml(data.jobTitle),
    client: escapeHtml(data.clientName),
    phone: data.clientPhone ? escapeHtml(data.clientPhone) : null,
    address: escapeHtml(data.propertyAddress),
    scope: escapeHtml(data.scope),
    price: escapeHtml(data.priceDisplay),
    pill: data.jobType === "hourly" ? "Hourly" : "Fixed",
    url: escapeHtml(data.reportUrl),
    support: escapeHtml(supportEmail),
    supportTel: escapeHtml(supportPhone),
    supportTelHref: telHref(supportPhone),
  };

  const phoneRow = safe.phone
    ? `<tr>
        <td colspan="2" style="padding:0;"><div style="border-top:1px solid #E4E4EC; height:1px; line-height:1px; font-size:1px;">&nbsp;</div></td>
      </tr>
      <tr>
        <td width="38%" valign="top" class="info-label" style="padding:10px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; color:#6B6B85;">Phone</td>
        <td width="62%" valign="top" style="padding:10px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:14px; line-height:21px; color:#0A0A1F; font-weight:500;">
          <a href="tel:${telHref(data.clientPhone!)}" style="color:#ED4B00; text-decoration:none; font-weight:600;">${safe.phone}</a>
        </td>
      </tr>`
    : "";

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en-GB"><head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light only" />
<title>Job booked — Fixfy</title>
<style>
  body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; display: block; }
  body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
  a { color: #ED4B00; text-decoration: underline; }
  @media screen and (max-width: 600px) {
    .container { width: 100% !important; }
    .px-mobile { padding-left: 24px !important; padding-right: 24px !important; }
    .h1-mobile { font-size: 24px !important; line-height: 32px !important; }
    .info-row td { display: block !important; width: 100% !important; padding: 4px 0 !important; }
    .info-label { padding-bottom: 2px !important; }
    .btn-mobile a { display: block !important; }
    .price-mobile { font-size: 32px !important; }
  }
</style>
</head><body style="margin:0; padding:0; background-color:#F7F7FB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
<div style="display:none; max-height:0px; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#F7F7FB;">Job booked. Here's everything you need to get started.</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7F7FB;">
  <tr><td align="center" style="padding: 32px 16px;">
    <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(2,0,64,0.08);">

      <!-- Header -->
      <tr><td align="center" style="background-color:#020040; padding:32px 40px;" class="px-mobile">
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:32px; font-weight:700; color:#FFFFFF; letter-spacing:-1px;">fixfy</div>
      </td></tr>

      <!-- Title -->
      <tr><td style="padding:40px 40px 24px 40px;" class="px-mobile">
        <h1 class="h1-mobile" style="margin:0 0 12px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:28px; line-height:36px; font-weight:700; color:#0A0A1F; letter-spacing:-0.5px;">Hi ${safe.name}, new job booked for you →</h1>
        <p style="margin:0 0 16px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:24px; color:#3A3A55;">Here's everything you need to get started.</p>
      </td></tr>

      <!-- Price -->
      <tr><td style="padding:0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#020040; background-image:linear-gradient(135deg,#020040 0%,#0A0A2E 100%); border-radius:10px;">
          <tr><td style="padding:24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td>
                  <p style="margin:0 0 4px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:rgba(255,255,255,0.64);">Your earnings</p>
                  <p class="price-mobile" style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:36px; line-height:42px; font-weight:700; color:#FFFFFF; letter-spacing:-1px;">${safe.price}</p>
                </td>
                <td align="right" valign="top">
                  <div style="display:inline-block; background-color:#ED4B00; color:#FFFFFF; padding:6px 12px; border-radius:999px; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase;">${safe.pill}</div>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </td></tr>

      <!-- Details card -->
      <tr><td style="padding:16px 40px 0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7F7FB; border:1px solid #E4E4EC; border-radius:10px;">
          <tr><td style="padding:24px;">
            <p style="margin:0 0 4px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#6B6B85;">Job #${safe.ref}</p>
            <p style="margin:0 0 20px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:18px; font-weight:600; color:#0A0A1F;">${safe.title}</p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="info-row">
              <tr>
                <td width="38%" valign="top" class="info-label" style="padding:10px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; color:#6B6B85;">Client</td>
                <td width="62%" valign="top" style="padding:10px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:14px; line-height:21px; color:#0A0A1F; font-weight:500;">${safe.client}</td>
              </tr>
              ${phoneRow}
              <tr>
                <td colspan="2" style="padding:0;"><div style="border-top:1px solid #E4E4EC; height:1px; line-height:1px; font-size:1px;">&nbsp;</div></td>
              </tr>
              <tr>
                <td width="38%" valign="top" class="info-label" style="padding:10px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; color:#6B6B85;">Address</td>
                <td width="62%" valign="top" style="padding:10px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:14px; line-height:21px; color:#0A0A1F; font-weight:500;">${safe.address}</td>
              </tr>
            </table>

            <div style="margin-top:18px; padding-top:18px; border-top:1px solid #E4E4EC;">
              <p style="margin:0 0 6px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; color:#6B6B85;">Scope of work</p>
              <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:14px; line-height:21px; color:#3A3A55; white-space:pre-wrap;">${safe.scope}</p>
            </div>
          </td></tr>
        </table>
      </td></tr>

      <!-- Communication notice -->
      <tr><td style="padding:16px 40px 0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#E1ECFF; border-radius:8px;">
          <tr><td style="padding:14px 16px;">
            <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:20px; color:#0A3A8C;">
              <strong style="color:#0B5FFF;">💬 Need to discuss anything?</strong> Just reply to this email — questions, updates, schedule changes or anything else about the job will be handled right here.
            </p>
          </td></tr>
        </table>
      </td></tr>

      <!-- CTA -->
      <tr><td align="center" style="padding:32px 40px 8px 40px;" class="px-mobile">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn-mobile">
          <tr><td align="center" style="border-radius:8px; background-color:#ED4B00;">
            <a href="${safe.url}" target="_blank" style="display:inline-block; padding:16px 36px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; font-weight:600; color:#FFFFFF; text-decoration:none; border-radius:8px;">Submit job report</a>
          </td></tr>
        </table>
      </td></tr>

      <!-- Helper text -->
      <tr><td align="center" style="padding:0 40px 32px 40px;" class="px-mobile">
        <p style="margin:0 0 4px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:20px; color:#6B6B85;">Submit the report once the work is complete to release payment.</p>
        <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:20px; color:#6B6B85;">Need help? Email <a href="mailto:${safe.support}" style="color:#ED4B00; text-decoration:underline;">${safe.support}</a> or call <a href="tel:${safe.supportTelHref}" style="color:#ED4B00; text-decoration:underline;">${safe.supportTel}</a>.</p>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background-color:#F7F7FB; padding:24px 40px; border-top:1px solid #E4E4EC;" class="px-mobile">
        <p style="margin:0 0 10px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:18px; color:#6B6B85;">You're receiving this email because you're registered as a partner with Fixfy.</p>
        <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:18px; color:#6B6B85;"><strong style="color:#3A3A55;">Fixfy</strong> · <a href="https://www.getfixfy.com" style="color:#6B6B85; text-decoration:underline;">www.getfixfy.com</a> · <a href="mailto:${safe.support}" style="color:#6B6B85; text-decoration:underline;">${safe.support}</a> · ${safe.supportTel}</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;

  const text = `Hi ${data.partnerFirstName || "there"}, new job booked for you.

Job #${data.jobReference}
${data.jobTitle}

Earnings: ${data.priceDisplay} (${data.jobType === "hourly" ? "Hourly" : "Fixed"})

Client: ${data.clientName}
${data.clientPhone ? `Phone: ${data.clientPhone}\n` : ""}Address: ${data.propertyAddress}

Scope of work
${data.scope}

Submit your job report once work is complete to release payment:
${data.reportUrl}

Need help? Email ${supportEmail} or call ${supportPhone}.

Reply to this email if you need to discuss anything about the job.

Fixfy · www.getfixfy.com`;

  return { subject, html, text };
}

/**
 * Status-update email — sent on cancelled / on_hold / status_changed /
 * resumed / completed events. Uses the same Fixfy navy/coral layout as
 * the assignment email but with a different headline + reason line.
 */
export type PartnerJobStatusKind = "status_changed" | "cancelled" | "on_hold" | "resumed" | "completed" | "rescheduled";

export interface PartnerJobStatusUpdateData {
  kind: PartnerJobStatusKind;
  partnerFirstName: string;
  jobReference: string;
  jobTitle: string;
  clientName: string;
  clientPhone?: string | null;
  propertyAddress: string;
  scope: string;
  /** Display label for the new status (e.g. "Cancelled", "On Hold", "In Progress"). */
  newStatusLabel: string;
  /** Optional reason line (cancellation reason, hold reason). */
  reason?: string | null;
  /** Where the partner submits the report — included for status changes that need it. */
  reportUrl: string;
  supportEmail?: string;
  supportPhone?: string;
}

const KIND_HEADLINE: Record<PartnerJobStatusKind, string> = {
  status_changed: "Job status updated",
  cancelled:      "Job cancelled",
  on_hold:        "Job placed on hold",
  resumed:        "Job resumed",
  completed:      "Job marked complete",
  rescheduled:    "Job rescheduled",
};

const KIND_INTRO: Record<PartnerJobStatusKind, string> = {
  status_changed: "The status of one of your jobs has changed.",
  cancelled:      "Unfortunately, this job has been cancelled by the office.",
  on_hold:        "This job has been placed on hold.",
  resumed:        "This job has been resumed and is active again.",
  completed:      "This job has been marked as complete.",
  rescheduled:    "This job has been moved to a new date.",
};

const KIND_PILL_COLOR: Record<PartnerJobStatusKind, string> = {
  status_changed: "#0B5FFF",
  cancelled:      "#DC2626",
  on_hold:        "#D97706",
  resumed:        "#16A34A",
  completed:      "#16A34A",
  rescheduled:    "#0E8A5F",
};

export function buildPartnerJobStatusUpdateEmail(data: PartnerJobStatusUpdateData): {
  subject: string;
  html: string;
  text: string;
} {
  const supportEmail = data.supportEmail ?? "support@getfixfy.com";
  const supportPhone = data.supportPhone ?? "+44 20 4538 4668";
  const headline = KIND_HEADLINE[data.kind];
  const intro = KIND_INTRO[data.kind];
  const pillColor = KIND_PILL_COLOR[data.kind];
  const subject = `${headline} — ${data.jobReference}`;

  const safe = {
    name: escapeHtml(data.partnerFirstName || "there"),
    headline: escapeHtml(headline),
    intro: escapeHtml(intro),
    ref: escapeHtml(data.jobReference),
    title: escapeHtml(data.jobTitle),
    client: escapeHtml(data.clientName),
    phone: data.clientPhone ? escapeHtml(data.clientPhone) : null,
    address: escapeHtml(data.propertyAddress),
    scope: escapeHtml(data.scope),
    status: escapeHtml(data.newStatusLabel),
    reason: data.reason ? escapeHtml(data.reason) : null,
    url: escapeHtml(data.reportUrl),
    support: escapeHtml(supportEmail),
    supportTel: escapeHtml(supportPhone),
    supportTelHref: telHref(supportPhone),
  };

  const reasonBlock = safe.reason
    ? `<div style="margin-top:14px; padding:14px; background:#FFF5EE; border:1px solid #FEE5D6; border-radius:6px; font-size:13px; color:#9A2A00;"><strong>Reason:</strong> ${safe.reason}</div>`
    : "";

  const ctaBlock = data.kind === "cancelled"
    ? "" // No CTA for cancelled — nothing for the partner to do
    : `<tr><td align="center" style="padding:32px 40px 8px 40px;" class="px-mobile">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn-mobile">
          <tr><td align="center" style="border-radius:8px; background-color:#ED4B00;">
            <a href="${safe.url}" target="_blank" style="display:inline-block; padding:16px 36px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; font-weight:600; color:#FFFFFF; text-decoration:none; border-radius:8px;">Open job in app</a>
          </td></tr>
        </table>
      </td></tr>`;

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en-GB"><head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${safe.headline} — Fixfy</title>
<style>
  body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; display: block; }
  body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
  a { color: #ED4B00; text-decoration: underline; }
  @media screen and (max-width: 600px) {
    .container { width: 100% !important; }
    .px-mobile { padding-left: 24px !important; padding-right: 24px !important; }
    .h1-mobile { font-size: 24px !important; line-height: 32px !important; }
    .info-row td { display: block !important; width: 100% !important; padding: 4px 0 !important; }
    .btn-mobile a { display: block !important; }
  }
</style>
</head><body style="margin:0; padding:0; background-color:#F7F7FB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7F7FB;">
  <tr><td align="center" style="padding: 32px 16px;">
    <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(2,0,64,0.08);">

      <tr><td align="center" style="background-color:#020040; padding:32px 40px;" class="px-mobile">
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:32px; font-weight:700; color:#FFFFFF; letter-spacing:-1px;">fixfy</div>
      </td></tr>

      <tr><td style="padding:40px 40px 8px 40px;" class="px-mobile">
        <div style="display:inline-block; background-color:${pillColor}; color:#FFFFFF; padding:6px 12px; border-radius:999px; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; margin-bottom:16px;">${safe.status}</div>
        <h1 class="h1-mobile" style="margin:0 0 12px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:28px; line-height:36px; font-weight:700; color:#0A0A1F; letter-spacing:-0.5px;">Hi ${safe.name}, ${safe.headline.toLowerCase()}</h1>
        <p style="margin:0 0 16px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:24px; color:#3A3A55;">${safe.intro}</p>
        ${reasonBlock}
      </td></tr>

      <tr><td style="padding:16px 40px 0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7F7FB; border:1px solid #E4E4EC; border-radius:10px;">
          <tr><td style="padding:24px;">
            <p style="margin:0 0 4px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#6B6B85;">Job #${safe.ref}</p>
            <p style="margin:0 0 20px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:18px; font-weight:600; color:#0A0A1F;">${safe.title}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="info-row">
              <tr><td width="38%" valign="top" style="padding:10px 0; font-size:13px; color:#6B6B85;">Client</td><td width="62%" valign="top" style="padding:10px 0; font-size:14px; line-height:21px; color:#0A0A1F; font-weight:500;">${safe.client}</td></tr>
              ${safe.phone ? `<tr><td colspan="2"><div style="border-top:1px solid #E4E4EC; height:1px;">&nbsp;</div></td></tr><tr><td width="38%" valign="top" style="padding:10px 0; font-size:13px; color:#6B6B85;">Phone</td><td width="62%" valign="top" style="padding:10px 0; font-size:14px;"><a href="tel:${telHref(data.clientPhone!)}" style="color:#ED4B00; text-decoration:none; font-weight:600;">${safe.phone}</a></td></tr>` : ""}
              <tr><td colspan="2"><div style="border-top:1px solid #E4E4EC; height:1px;">&nbsp;</div></td></tr>
              <tr><td width="38%" valign="top" style="padding:10px 0; font-size:13px; color:#6B6B85;">Address</td><td width="62%" valign="top" style="padding:10px 0; font-size:14px; line-height:21px; color:#0A0A1F; font-weight:500;">${safe.address}</td></tr>
            </table>
            <div style="margin-top:18px; padding-top:18px; border-top:1px solid #E4E4EC;">
              <p style="margin:0 0 6px 0; font-size:13px; color:#6B6B85;">Scope of work</p>
              <p style="margin:0; font-size:14px; line-height:21px; color:#3A3A55; white-space:pre-wrap;">${safe.scope}</p>
            </div>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:16px 40px 0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#E1ECFF; border-radius:8px;">
          <tr><td style="padding:14px 16px;">
            <p style="margin:0; font-size:13px; line-height:20px; color:#0A3A8C;"><strong style="color:#0B5FFF;">💬 Questions?</strong> Reply to this email — we'll respond as soon as we can.</p>
          </td></tr>
        </table>
      </td></tr>

      ${ctaBlock}

      <tr><td align="center" style="padding:0 40px 32px 40px;" class="px-mobile">
        <p style="margin:0; font-size:13px; line-height:20px; color:#6B6B85;">Need help? Email <a href="mailto:${safe.support}" style="color:#ED4B00;">${safe.support}</a> or call <a href="tel:${safe.supportTelHref}" style="color:#ED4B00;">${safe.supportTel}</a>.</p>
      </td></tr>

      <tr><td style="background-color:#F7F7FB; padding:24px 40px; border-top:1px solid #E4E4EC;" class="px-mobile">
        <p style="margin:0; font-size:12px; line-height:18px; color:#6B6B85;"><strong style="color:#3A3A55;">Fixfy</strong> · <a href="https://www.getfixfy.com" style="color:#6B6B85;">www.getfixfy.com</a> · <a href="mailto:${safe.support}" style="color:#6B6B85;">${safe.support}</a> · ${safe.supportTel}</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;

  const reasonText = data.reason ? `\nReason: ${data.reason}\n` : "";
  const text = `Hi ${data.partnerFirstName || "there"}, ${headline.toLowerCase()}.

Status: ${data.newStatusLabel}
${reasonText}
Job #${data.jobReference}
${data.jobTitle}

Client: ${data.clientName}
${data.clientPhone ? `Phone: ${data.clientPhone}\n` : ""}Address: ${data.propertyAddress}

Scope of work
${data.scope}
${data.kind === "cancelled" ? "" : `\nOpen job in app: ${data.reportUrl}\n`}
Need help? Email ${supportEmail} or call ${supportPhone}.

Fixfy · www.getfixfy.com`;

  return { subject, html, text };
}

/**
 * Booking rescheduled email — sent when a job's scheduled date/window changes.
 * Mirrors job-rescheduled-customer-PREVIEW.html with side-by-side date
 * comparison + booking details card.
 */
export interface PartnerJobRescheduledData {
  /** First name of the recipient (partner first name, or customer first name when sending the customer variant). */
  recipientFirstName: string;
  jobReference: string;
  jobTitle: string;
  propertyAddress: string;
  /** Pre-formatted display strings (e.g. "Saturday, 3 May" + "09:00 – 11:00"). */
  oldDateLine: string;
  oldTimeLine?: string | null;
  newDateLine: string;
  newTimeLine?: string | null;
  supportEmail?: string;
  supportPhone?: string;
}

export function buildJobRescheduledEmail(data: PartnerJobRescheduledData): {
  subject: string;
  html: string;
  text: string;
} {
  const supportEmail = data.supportEmail ?? "support@getfixfy.com";
  const supportPhone = data.supportPhone ?? "+44 20 4538 4668";
  const subject = `Booking rescheduled — ${data.jobReference}`;

  const safe = {
    name:    escapeHtml(data.recipientFirstName || "there"),
    ref:     escapeHtml(data.jobReference),
    title:   escapeHtml(data.jobTitle),
    address: escapeHtml(data.propertyAddress),
    oldDate: escapeHtml(data.oldDateLine || "—"),
    oldTime: data.oldTimeLine ? escapeHtml(data.oldTimeLine) : "",
    newDate: escapeHtml(data.newDateLine || "—"),
    newTime: data.newTimeLine ? escapeHtml(data.newTimeLine) : "",
    support: escapeHtml(supportEmail),
    supportTel: escapeHtml(supportPhone),
    supportTelHref: telHref(supportPhone),
  };

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en-GB"><head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Booking rescheduled — Fixfy</title>
<style>
  body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; display: block; }
  body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
  a { color: #ED4B00; text-decoration: underline; }
  @media screen and (max-width: 600px) {
    .container { width: 100% !important; }
    .px-mobile { padding-left: 24px !important; padding-right: 24px !important; }
    .h1-mobile { font-size: 24px !important; line-height: 32px !important; }
    .schedule-stack td { display: block !important; width: 100% !important; padding: 12px 0 !important; }
    .schedule-arrow { display: none !important; }
  }
</style>
</head><body style="margin:0; padding:0; background-color:#F7F7FB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
<div style="display:none; max-height:0px; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#F7F7FB;">Your booking ${safe.ref} has been rescheduled to ${safe.newDate}${safe.newTime ? " at " + safe.newTime : ""}.</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7F7FB;">
  <tr><td align="center" style="padding: 32px 16px;">
    <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(2,0,64,0.08);">

      <tr><td align="center" style="background-color:#020040; padding:16px 40px;" class="px-mobile">
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:22px; font-weight:700; color:#FFFFFF; letter-spacing:-0.6px;">fixfy</div>
      </td></tr>

      <tr><td style="padding:36px 40px 20px 40px;" class="px-mobile">
        <h1 class="h1-mobile" style="margin:0 0 10px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:26px; line-height:34px; font-weight:700; color:#0A0A1F; letter-spacing:-0.5px;">Hi ${safe.name}, your booking has been rescheduled 🗓</h1>
        <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#3A3A55;">Just a quick heads up — your job has been moved to a new date. Please check the updated schedule below and save it to your calendar.</p>
      </td></tr>

      <tr><td style="padding:0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="schedule-stack" style="border-collapse:collapse;">
          <tr>
            <td valign="top" width="46%" style="background-color:#F7F7FB; border:1px solid #E4E4EC; border-radius:10px; padding:16px 18px;">
              <p style="margin:0 0 6px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:10px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#6B6B85;">Was</p>
              <p style="margin:0 0 4px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; line-height:21px; font-weight:600; color:#6B6B85; text-decoration:line-through;">${safe.oldDate}</p>
              ${safe.oldTime ? `<p style="margin:0; font-size:13px; line-height:19px; color:#6B6B85; text-decoration:line-through;">${safe.oldTime}</p>` : ""}
            </td>
            <td align="center" valign="middle" width="8%" class="schedule-arrow" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:20px; color:#6B6B85; padding:0 4px;">→</td>
            <td valign="top" width="46%" style="background-color:#E4F4EC; border:1px solid #B5DCC8; border-radius:10px; padding:16px 18px;">
              <p style="margin:0 0 6px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:10px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#0E8A5F;">📅 New schedule</p>
              <p style="margin:0 0 4px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; line-height:21px; font-weight:700; color:#0A5A3F;">${safe.newDate}</p>
              ${safe.newTime ? `<p style="margin:0; font-size:13px; line-height:19px; color:#0A5A3F;">${safe.newTime}</p>` : ""}
            </td>
          </tr>
        </table>
      </td></tr>

      <tr><td style="padding:16px 40px 0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7F7FB; border:1px solid #E4E4EC; border-radius:10px;">
          <tr><td style="padding:20px 22px;">
            <p style="margin:0 0 4px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#6B6B85;">Booking #${safe.ref}</p>
            <p style="margin:0 0 4px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; font-weight:600; color:#0A0A1F;">${safe.title}</p>
            <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:20px; color:#3A3A55;">📍 ${safe.address}</p>
          </td></tr>
        </table>
      </td></tr>

      <tr><td align="center" style="padding:24px 40px 28px 40px;" class="px-mobile">
        <p style="margin:0 0 4px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:20px; color:#6B6B85;">The new date doesn&rsquo;t work? Just reply to this email and we&rsquo;ll sort it.</p>
        <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:20px; color:#6B6B85;">Got a question? Email <a href="mailto:${safe.support}" style="color:#ED4B00; text-decoration:underline;">${safe.support}</a> or call <a href="tel:${safe.supportTelHref}" style="color:#ED4B00; text-decoration:underline;">${safe.supportTel}</a>.</p>
      </td></tr>

      <tr><td style="background-color:#020040; background-image:linear-gradient(135deg,#020040 0%,#010030 100%); padding:18px 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td><p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:14px; font-weight:700; letter-spacing:-0.3px; color:#FFFFFF;">Fix<span style="color:#ED4B00;">fy</span></p></td>
            <td align="right"><p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:11px; line-height:18px; color:rgba(255,255,255,0.64);"><a href="https://www.getfixfy.com" style="color:rgba(255,255,255,0.92); text-decoration:none;">getfixfy.com</a> · <a href="mailto:${safe.support}" style="color:rgba(255,255,255,0.92); text-decoration:none;">${safe.support}</a> · <a href="tel:${safe.supportTelHref}" style="color:rgba(255,255,255,0.92); text-decoration:none;">${safe.supportTel}</a></p></td>
          </tr>
        </table>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;

  const text = `Hi ${data.recipientFirstName || "there"}, your booking has been rescheduled.

Was: ${data.oldDateLine}${data.oldTimeLine ? " · " + data.oldTimeLine : ""}
Now: ${data.newDateLine}${data.newTimeLine ? " · " + data.newTimeLine : ""}

Booking #${data.jobReference}
${data.jobTitle}
${data.propertyAddress}

Reply to this email if the new date doesn't work, or contact ${supportEmail} / ${supportPhone}.

Fixfy · www.getfixfy.com`;

  return { subject, html, text };
}
