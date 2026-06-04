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

import {
  partnerEmailBaseStyles,
  partnerEmailBodyOpen,
  partnerEmailHeadBlock,
  partnerEmailLogoHeaderRow,
  partnerEmailPreheaderHtml,
} from "@/lib/emails/partner-email-layout";
import { extractUkPostcode } from "@/lib/uk-postcode";
import { PARTNER_JOB_EMAIL_NOTES_REPORT_DEADLINE } from "@/lib/partner-job-email-notes";

export interface PartnerJobConfirmationData {
  partnerFirstName: string;
  jobReference: string;
  jobTitle: string;
  clientName: string;
  /** Partner-facing emails NEVER show the customer's phone — only name + address. */
  propertyAddress: string;
  /** YYYY-MM-DD — used in the email subject line. */
  scheduledDate?: string | null;
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
  /** Hourly/fixed + type-of-work rules shown in the blue notice block. */
  partnerNotes?: string | null;
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

function formatPartnerJobEmailSubjectDate(scheduledDate?: string | null): string {
  const raw = scheduledDate?.trim();
  if (!raw) return "TBC";
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
    }
  }
  return raw;
}

function partnerJobEmailSubject(args: {
  kind: "offer" | "booked";
  jobTitle: string;
  scheduledDate?: string | null;
  propertyAddress: string;
}): string {
  const typeOfWork = args.jobTitle.trim() || "Job";
  const date = formatPartnerJobEmailSubjectDate(args.scheduledDate);
  const postcode = extractUkPostcode(args.propertyAddress) ?? "—";
  if (args.kind === "offer") {
    return `New Job Offer: ${typeOfWork} ${date} ${postcode} — Tap to Accept`;
  }
  return `Job Booked: ${typeOfWork} ${date} ${postcode}`;
}

function partnerJobEmailNotesHtmlBlock(notes: string): string {
  const safe = escapeHtml(notes);
  return `      <!-- Partner notes -->
      <tr><td style="padding:16px 40px 0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#E1ECFF; border-radius:8px;">
          <tr><td style="padding:14px 16px;">
            <p style="margin:0 0 6px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#0B5FFF;">Important — before you start</p>
            <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:20px; color:#0A3A8C; white-space:pre-wrap;">${safe}</p>
          </td></tr>
        </table>
      </td></tr>`;
}

export function buildPartnerJobConfirmationEmail(data: PartnerJobConfirmationData): {
  subject: string;
  html: string;
  text: string;
} {
  const supportEmail = data.supportEmail ?? "support@getfixfy.com";
  const supportPhone = data.supportPhone ?? "+44 20 4538 4668";
  const subject = partnerJobEmailSubject({
    kind: "booked",
    jobTitle: data.jobTitle,
    scheduledDate: data.scheduledDate,
    propertyAddress: data.propertyAddress,
  });

  const safe = {
    name: escapeHtml(data.partnerFirstName || "there"),
    ref: escapeHtml(data.jobReference),
    title: escapeHtml(data.jobTitle),
    client: escapeHtml(data.clientName),
    address: escapeHtml(data.propertyAddress),
    scope: escapeHtml(data.scope),
    price: escapeHtml(data.priceDisplay),
    pill: data.jobType === "hourly" ? "Hourly" : "Fixed",
    url: escapeHtml(data.reportUrl),
    support: escapeHtml(supportEmail),
    supportTel: escapeHtml(supportPhone),
    supportTelHref: telHref(supportPhone),
  };

  const partnerNotes = data.partnerNotes?.trim() || "";
  const notesBlock = partnerNotes ? partnerJobEmailNotesHtmlBlock(partnerNotes) : "";
  const reportDeadlineNote = escapeHtml(PARTNER_JOB_EMAIL_NOTES_REPORT_DEADLINE);

  /** Customer phone is intentionally NOT rendered — partner emails carry name + address only. */
  const phoneRow = "";

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en-GB"><head>
${partnerEmailHeadBlock()}
${partnerEmailBaseStyles()}
</head>
${partnerEmailBodyOpen()}
${partnerEmailPreheaderHtml("Job booked. Here's everything you need to get started.")}

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" bgcolor="#F7F7FB" style="background-color:#F7F7FB;">
  <tr><td align="center" style="padding: 32px 16px;">
    <table role="presentation" class="container email-card" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:600px; max-width:600px; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(2,0,64,0.08);">

${partnerEmailLogoHeaderRow()}

      <!-- Title -->
      <tr><td style="padding:40px 40px 24px 40px;" class="px-mobile">
        <h1 class="h1-mobile" style="margin:0 0 12px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:28px; line-height:36px; font-weight:700; color:#0A0A1F; letter-spacing:-0.5px;">Hi ${safe.name}, new job booked for you →</h1>
        <p style="margin:0 0 16px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:24px; color:#3A3A55;">Here's everything you need to get started.</p>
      </td></tr>

      <!-- Price -->
      <tr><td style="padding:0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#020040" style="background-color:#020040; border-radius:10px;">
          <tr><td bgcolor="#020040" style="padding:24px; background-color:#020040;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td>
                  <p style="margin:0 0 4px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#B8B8D0;">Your earnings</p>
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

      ${notesBlock}

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
        <p style="margin:0 0 4px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:20px; color:#6B6B85;">${reportDeadlineNote}</p>
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
Address: ${data.propertyAddress}

Scope of work
${data.scope}
${partnerNotes ? `\nImportant\n${partnerNotes}\n` : ""}
${PARTNER_JOB_EMAIL_NOTES_REPORT_DEADLINE}

Submit job report: ${data.reportUrl}

Need help? Email ${supportEmail} or call ${supportPhone}.

Questions? Reply to this email.

Fixfy · www.getfixfy.com`;

  return { subject, html, text };
}

/**
 * Status-update email — sent on cancelled / on_hold / status_changed /
 * resumed / completed events. Uses the same Fixfy navy/coral layout as
 * the assignment email but with a different headline + reason line.
 */
export type PartnerJobStatusKind = "status_changed" | "cancelled" | "on_hold" | "resumed" | "completed" | "rescheduled" | "confirmation_request" | "booked";

export interface PartnerJobStatusUpdateData {
  kind: PartnerJobStatusKind;
  partnerFirstName: string;
  jobReference: string;
  jobTitle: string;
  clientName: string;
  /** Partner-facing emails NEVER show the customer's phone — only name + address. */
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
  status_changed:       "Job status updated",
  cancelled:            "Job cancelled",
  on_hold:              "Job placed on hold",
  resumed:              "Job resumed",
  completed:            "Job marked complete",
  rescheduled:          "Job rescheduled",
  // confirmation_request / booked are handled by their own dedicated builders
  // and never hit this generic status-update layout, but they still need to
  // satisfy the Record type (unused values).
  confirmation_request: "Please confirm this job",
  booked:               "Job booked",
};

const KIND_INTRO: Record<PartnerJobStatusKind, string> = {
  status_changed:       "The status of one of your jobs has changed.",
  cancelled:            "Unfortunately, this job has been cancelled by the office.",
  on_hold:              "This job has been placed on hold.",
  resumed:              "This job has been resumed and is active again.",
  completed:            "This job has been marked as complete.",
  rescheduled:          "This job has been moved to a new date.",
  confirmation_request: "We've allocated this job to you — please accept it.",
  booked:               "Your job is booked.",
};

const KIND_PILL_COLOR: Record<PartnerJobStatusKind, string> = {
  status_changed:       "#0B5FFF",
  cancelled:            "#DC2626",
  on_hold:              "#D97706",
  resumed:              "#16A34A",
  completed:            "#16A34A",
  rescheduled:          "#0E8A5F",
  confirmation_request: "#0B5FFF",
  booked:               "#0E8A5F",
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
${partnerEmailHeadBlock()}
${partnerEmailBaseStyles()}
</head>
${partnerEmailBodyOpen()}
${partnerEmailPreheaderHtml(`${headline} — ${data.jobReference}`)}

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" bgcolor="#F7F7FB" style="background-color:#F7F7FB;">
  <tr><td align="center" style="padding: 32px 16px;">
    <table role="presentation" class="container email-card" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:600px; max-width:600px; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(2,0,64,0.08);">

${partnerEmailLogoHeaderRow()}

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
Address: ${data.propertyAddress}

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
${partnerEmailHeadBlock()}
${partnerEmailBaseStyles(`    .schedule-stack td { display: block !important; width: 100% !important; padding: 12px 0 !important; }
    .schedule-arrow { display: none !important; }`)}
</head>
${partnerEmailBodyOpen()}
${partnerEmailPreheaderHtml(`Your booking ${safe.ref} has been rescheduled to ${safe.newDate}${safe.newTime ? " at " + safe.newTime : ""}.`)}

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" bgcolor="#F7F7FB" style="background-color:#F7F7FB;">
  <tr><td align="center" style="padding: 32px 16px;">
    <table role="presentation" class="container email-card" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:600px; max-width:600px; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(2,0,64,0.08);">

${partnerEmailLogoHeaderRow("16px 40px")}

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

/**
 * Dedicated on-hold email — sent via Zendesk side conversation to the
 * assigned partner when the office puts a job on hold. Layout, copy and
 * styling mirror job-on-hold-partner-PREVIEW.html: red urgency strip,
 * payment-on-hold notice, "what we need from you" evidence list, and a
 * 12-hour deadline notice.
 *
 * The internal `on_hold_reason` is intentionally NOT shown — partners get
 * a fixed evidence checklist instead, matching the approved template.
 */
export interface PartnerJobOnHoldData {
  partnerFirstName: string;
  jobReference:     string;
  jobTitle:         string;
  propertyAddress:  string;
  /** Partner-scoped link to the "resolve this job" form (notes + photos). Primary CTA. */
  resolveUrl:       string;
  /**
   * What the customer reported (the complaint reason). Shown to the partner
   * so they know what to address. Omitted from the email when empty or when
   * it's only the generic system placeholder.
   */
  complaintReason?: string | null;
  supportEmail?:    string;
  supportPhone?:    string;
}

export function buildPartnerJobOnHoldEmail(data: PartnerJobOnHoldData): {
  subject: string;
  html:    string;
  text:    string;
} {
  const supportEmail = data.supportEmail ?? "support@getfixfy.com";
  const supportPhone = data.supportPhone ?? "+44 20 4538 4668";
  const subject = `Action required — a complaint was raised on Job ${data.jobReference}`;

  // Only surface the reason when it's a real description, not the generic
  // system placeholder the webhook falls back to.
  const rawReason = (data.complaintReason ?? "").trim();
  const showReason = rawReason.length > 0 && !/^customer complaint/i.test(rawReason);

  const safe = {
    name:           escapeHtml(data.partnerFirstName || "there"),
    ref:            escapeHtml(data.jobReference),
    title:          escapeHtml(data.jobTitle),
    address:        escapeHtml(data.propertyAddress || "—"),
    resolveUrl:     escapeHtml(data.resolveUrl),
    reason:         escapeHtml(rawReason),
    support:        escapeHtml(supportEmail),
    supportTel:     escapeHtml(supportPhone),
    supportTelHref: telHref(supportPhone),
  };

  // Optional "what the customer reported" block, inserted under the job card.
  const reasonBlockHtml = showReason
    ? `
      <tr><td style="padding:16px 40px 0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFF7ED; border:1px solid #F3D9A4; border-radius:10px;">
          <tr><td style="padding:18px 20px;">
            <p style="margin:0 0 6px 0; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#9A6B00;">What the customer reported</p>
            <p style="margin:0; font-size:14px; line-height:21px; color:#0A0A1F; white-space:pre-wrap;">${safe.reason}</p>
          </td></tr>
        </table>
      </td></tr>`
    : "";

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en-GB"><head>
${partnerEmailHeadBlock()}
${partnerEmailBaseStyles()}
</head>
${partnerEmailBodyOpen()}
${partnerEmailPreheaderHtml(`Job ${safe.ref} is on hold. We need your help to resolve within 12 hours — please reply with the evidence requested.`)}

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" bgcolor="#F7F7FB" style="background-color:#F7F7FB;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" class="container email-card" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:600px; max-width:600px; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(2,0,64,0.08);">

      <tr><td bgcolor="#C8102E" style="background-color:#C8102E; padding:10px 40px; text-align:center;" class="px-mobile">
        <p style="margin:0; font-size:12px; font-weight:700; letter-spacing:0.6px; text-transform:uppercase; color:#FFFFFF;">⚠ Action required — respond within 12 hours</p>
      </td></tr>

${partnerEmailLogoHeaderRow()}

      <tr><td style="padding:40px 40px 24px 40px;" class="px-mobile">
        <h1 class="h1-mobile" style="margin:0 0 12px 0; font-size:28px; line-height:36px; font-weight:700; color:#0A0A1F; letter-spacing:-0.5px;">Hi ${safe.name}, a complaint was raised on this job — we need your help to resolve</h1>
        <p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#3A3A55;">A complaint has come in about the job below, so we've placed it on hold while we look into it. We've committed to the customer that we'll resolve this within 24 hours, so we'll need your reply with the evidence below within <strong style="color:#0A0A1F;">12 hours</strong>.</p>
      </td></tr>

      <tr><td style="padding:0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7F7FB; border:1px solid #E4E4EC; border-radius:10px;">
          <tr><td style="padding:24px;">
            <p style="margin:0 0 4px 0; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#6B6B85;">Job #${safe.ref}</p>
            <p style="margin:0 0 16px 0; font-size:18px; font-weight:600; color:#0A0A1F;">${safe.title}</p>
            <div style="display:inline-block; background-color:#FBEFD6; color:#C47A00; padding:6px 12px; border-radius:999px; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase;">⏸ On hold</div>
            <div style="margin-top:18px; padding-top:18px; border-top:1px solid #E4E4EC;">
              <p style="margin:0 0 4px 0; font-size:13px; color:#6B6B85;">Location</p>
              <p style="margin:0; font-size:14px; line-height:21px; color:#3A3A55;">${safe.address}</p>
            </div>
          </td></tr>
        </table>
      </td></tr>
${reasonBlockHtml}
      <tr><td style="padding:16px 40px 0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FBE3E7; border-left:3px solid #C8102E; border-radius:8px;">
          <tr><td style="padding:14px 16px;">
            <p style="margin:0; font-size:13px; line-height:20px; color:#7A0A1E;"><strong style="color:#C8102E;">💰 Payment on hold until resolved.</strong> Your payment for this job is paused until we receive the evidence and close the case.</p>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:24px 40px 0 40px;" class="px-mobile">
        <p style="margin:0 0 12px 0; font-size:15px; font-weight:700; color:#0A0A1F;">What we need from you</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FBEFD6; border-left:3px solid #C47A00; border-radius:6px;">
          <tr><td style="padding:16px 20px;">
            <p style="margin:0 0 10px 0; font-size:14px; line-height:21px; color:#0A0A1F;">Tap the button below and send us:</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
              <tr><td valign="top" width="20" style="padding:4px 0; font-size:14px; color:#C47A00; font-weight:700;">•</td><td valign="top" style="padding:4px 0; font-size:14px; line-height:21px; color:#0A0A1F;"><strong>A short written summary</strong> of what was done and how you can resolve the issue</td></tr>
              <tr><td valign="top" width="20" style="padding:4px 0; font-size:14px; color:#C47A00; font-weight:700;">•</td><td valign="top" style="padding:4px 0; font-size:14px; line-height:21px; color:#0A0A1F;"><strong>Photos</strong> of the work area / completed work</td></tr>
              <tr><td valign="top" width="20" style="padding:4px 0; font-size:14px; color:#C47A00; font-weight:700;">•</td><td valign="top" style="padding:4px 0; font-size:14px; line-height:21px; color:#0A0A1F;">Anything relevant — <strong>receipts</strong> for materials, <strong>certificates</strong> (CP12, electrical), etc.</td></tr>
            </table>
          </td></tr>
        </table>
      </td></tr>

      <!-- Primary CTA: open the resolution form -->
      <tr><td align="center" style="padding:28px 40px 8px 40px;" class="px-mobile">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
          <tr><td align="center" style="border-radius:10px; background-color:#ED4B00; background-image:linear-gradient(135deg,#ED4B00 0%,#FF7A29 100%);">
            <a href="${safe.resolveUrl}" target="_blank" style="display:inline-block; padding:16px 40px; font-size:16px; font-weight:700; color:#FFFFFF; text-decoration:none; letter-spacing:0.2px; border-radius:10px;">Resolve this job →</a>
          </td></tr>
        </table>
        <p style="margin:14px 0 0 0; font-size:12px; line-height:18px; color:#6B6B85;">Takes 2 minutes — add a note and snap a few photos, no app or login needed.</p>
      </td></tr>

      <tr><td style="padding:16px 40px 0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#E1ECFF; border-radius:8px;">
          <tr><td style="padding:14px 16px;">
            <p style="margin:0; font-size:13px; line-height:20px; color:#0A3A8C;"><strong style="color:#0B5FFF;">⏱ Please respond within 12 hours</strong> so we can resolve this for the customer in time.</p>
          </td></tr>
        </table>
      </td></tr>

      <tr><td align="center" style="padding:32px 40px 32px 40px;" class="px-mobile">
        <p style="margin:0 0 8px 0; font-size:12px; line-height:18px; color:#9A9AAE; word-break:break-all;">Button not working? Paste this link into your browser:<br/><a href="${safe.resolveUrl}" style="color:#ED4B00;">${safe.resolveUrl}</a></p>
        <p style="margin:0; font-size:13px; line-height:20px; color:#6B6B85;">Need to talk this through? Call us on <a href="tel:${safe.supportTelHref}" style="color:#ED4B00; font-weight:600;">${safe.supportTel}</a> or email <a href="mailto:${safe.support}" style="color:#ED4B00;">${safe.support}</a>.</p>
      </td></tr>

      <tr><td style="background-color:#F7F7FB; padding:24px 40px; border-top:1px solid #E4E4EC;" class="px-mobile">
        <p style="margin:0 0 10px 0; font-size:12px; line-height:18px; color:#6B6B85;">You're receiving this email because you're registered as a partner with Fixfy.</p>
        <p style="margin:0; font-size:12px; line-height:18px; color:#6B6B85;"><strong style="color:#3A3A55;">Fixfy</strong> · <a href="https://www.getfixfy.com" style="color:#6B6B85;">www.getfixfy.com</a> · <a href="mailto:${safe.support}" style="color:#6B6B85;">${safe.support}</a> · ${safe.supportTel}</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;

  const text =
`ACTION REQUIRED — RESPOND WITHIN 12 HOURS

Hi ${data.partnerFirstName || "there"},

A complaint has been raised about this job, so we've placed it on hold
while we look into it and we need your help to resolve it. We've committed
to the customer that we'll resolve within 24 hours, so please reply within
12 hours.

Job #${data.jobReference} — ${data.jobTitle}
Location: ${data.propertyAddress || "—"}
Status: ON HOLD
${showReason ? `\nWhat the customer reported:\n${rawReason}\n` : ""}
Payment on hold until resolved.

Resolve this job (add a note + photos, no app or login needed):
${data.resolveUrl}

Please send us:
  • A short written summary of what was done and how you can resolve the issue
  • Photos of the work area / completed work
  • Anything relevant — receipts for materials, certificates (CP12, electrical), etc.

Please respond within 12 hours.

Need to talk this through? Call ${supportPhone} or email ${supportEmail}.

Fixfy · www.getfixfy.com`;

  return { subject, html, text };
}

/**
 * "Your bid was approved — you've been booked for this job".
 * Sent in a Side Conversation on the quote's parent ticket the moment OS
 * staff approve a partner's bid. No acceptance step — partner already
 * committed when they submitted the bid.
 */
export interface PartnerJobBookedFromBidData {
  partnerFirstName: string;
  jobReference:     string;
  jobTitle:         string;
  clientName:       string;
  /** Partner-facing emails NEVER show the customer's phone — only name + address. */
  propertyAddress:  string;
  /** YYYY-MM-DD — used in the email subject line. */
  scheduledDate?:   string | null;
  scope:            string;
  /** £ display value (e.g. "£280.00"). */
  priceDisplay:     string;
  /** Partner-scoped report URL — primary CTA. */
  reportUrl:        string;
  /** Hourly/fixed + type-of-work rules shown in the blue notice block. */
  partnerNotes?:    string | null;
  supportEmail?:    string;
  supportPhone?:    string;
}

export function buildPartnerJobBookedFromBidEmail(data: PartnerJobBookedFromBidData): {
  subject: string;
  html:    string;
  text:    string;
} {
  const supportEmail = data.supportEmail ?? "support@getfixfy.com";
  const supportPhone = data.supportPhone ?? "+44 20 4538 4668";
  const subject = partnerJobEmailSubject({
    kind: "booked",
    jobTitle: data.jobTitle,
    scheduledDate: data.scheduledDate,
    propertyAddress: data.propertyAddress,
  });

  const partnerNotes = data.partnerNotes?.trim() || "";
  const notesBlock = partnerNotes ? partnerJobEmailNotesHtmlBlock(partnerNotes) : "";
  const reportDeadlineNote = escapeHtml(PARTNER_JOB_EMAIL_NOTES_REPORT_DEADLINE);

  const safe = {
    name:    escapeHtml(data.partnerFirstName || "there"),
    ref:     escapeHtml(data.jobReference),
    title:   escapeHtml(data.jobTitle),
    client:  escapeHtml(data.clientName),
    address: escapeHtml(data.propertyAddress),
    scope:   escapeHtml(data.scope),
    price:   escapeHtml(data.priceDisplay),
    url:     escapeHtml(data.reportUrl),
    support: escapeHtml(supportEmail),
    supportTel:     escapeHtml(supportPhone),
    supportTelHref: telHref(supportPhone),
  };

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en-GB"><head>
${partnerEmailHeadBlock()}
${partnerEmailBaseStyles()}
</head>
${partnerEmailBodyOpen()}
${partnerEmailPreheaderHtml("Your bid was approved — you're booked for this job.")}

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" bgcolor="#F7F7FB" style="background-color:#F7F7FB;">
  <tr><td align="center" style="padding: 32px 16px;">
    <table role="presentation" class="container email-card" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:600px; max-width:600px; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(2,0,64,0.08);">
      <tr><td bgcolor="#0E8A5F" style="background-color:#0E8A5F; padding:10px 40px; text-align:center;" class="px-mobile">
        <p style="margin:0; font-size:12px; font-weight:700; letter-spacing:0.6px; text-transform:uppercase; color:#FFFFFF;">✓ Bid approved — job booked</p>
      </td></tr>
${partnerEmailLogoHeaderRow()}
      <tr><td style="padding:40px 40px 24px 40px;" class="px-mobile">
        <h1 class="h1-mobile" style="margin:0 0 12px 0; font-size:28px; line-height:36px; font-weight:700; color:#0A0A1F; letter-spacing:-0.5px;">Hi ${safe.name}, your bid was approved 🎉</h1>
        <p style="margin:0 0 8px 0; font-size:16px; line-height:24px; color:#3A3A55;">You've been booked for the job below. We'll handle the customer side from here — no need to confirm anything else.</p>
      </td></tr>
      <tr><td style="padding:0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#020040" style="background-color:#020040; border-radius:10px;">
          <tr><td bgcolor="#020040" style="padding:24px; background-color:#020040;">
            <p style="margin:0 0 4px 0; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#B8B8D0;">Your earnings</p>
            <p style="margin:0; font-size:32px; font-weight:700; color:#FFFFFF; letter-spacing:-1px;">${safe.price}</p>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:16px 40px 0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7F7FB; border:1px solid #E4E4EC; border-radius:10px;">
          <tr><td style="padding:24px;">
            <p style="margin:0 0 4px 0; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#6B6B85;">Job #${safe.ref}</p>
            <p style="margin:0 0 16px 0; font-size:18px; font-weight:600; color:#0A0A1F;">${safe.title}</p>
            <div style="border-top:1px solid #E4E4EC; padding-top:14px;">
              <p style="margin:0 0 4px 0; font-size:13px; color:#6B6B85;">Client</p>
              <p style="margin:0; font-size:14px; color:#0A0A1F; font-weight:500;">${safe.client}</p>
            </div>
            <div style="margin-top:14px; padding-top:14px; border-top:1px solid #E4E4EC;">
              <p style="margin:0 0 4px 0; font-size:13px; color:#6B6B85;">Address</p>
              <p style="margin:0; font-size:14px; line-height:21px; color:#0A0A1F; font-weight:500;">${safe.address}</p>
            </div>
            <div style="margin-top:14px; padding-top:14px; border-top:1px solid #E4E4EC;">
              <p style="margin:0 0 4px 0; font-size:13px; color:#6B6B85;">Scope of work</p>
              <p style="margin:0; font-size:14px; line-height:21px; color:#3A3A55; white-space:pre-wrap;">${safe.scope}</p>
            </div>
          </td></tr>
        </table>
      </td></tr>
${notesBlock}
      <tr><td align="center" style="padding:32px 40px 8px 40px;" class="px-mobile btn-mobile">
        <a href="${safe.url}" target="_blank" style="display:inline-block; padding:16px 36px; background-color:#ED4B00; color:#FFFFFF; font-size:15px; font-weight:600; text-decoration:none; border-radius:8px;">Open job in app</a>
      </td></tr>
      <tr><td align="center" style="padding:0 40px 16px 40px;" class="px-mobile">
        <p style="margin:0; font-size:12px; line-height:18px; color:#6B6B85;">${reportDeadlineNote}</p>
      </td></tr>
      <tr><td align="center" style="padding:0 40px 32px 40px;" class="px-mobile">
        <p style="margin:0; font-size:13px; line-height:20px; color:#6B6B85;">Questions? Email <a href="mailto:${safe.support}" style="color:#ED4B00;">${safe.support}</a> or call <a href="tel:${safe.supportTelHref}" style="color:#ED4B00;">${safe.supportTel}</a>.</p>
      </td></tr>
      <tr><td style="background-color:#F7F7FB; padding:20px 40px; border-top:1px solid #E4E4EC;" class="px-mobile">
        <p style="margin:0; font-size:12px; line-height:18px; color:#6B6B85;"><strong style="color:#3A3A55;">Fixfy</strong> · <a href="https://www.getfixfy.com" style="color:#6B6B85;">www.getfixfy.com</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const text =
`BID APPROVED — JOB BOOKED

Hi ${data.partnerFirstName || "there"},

Your bid was approved. You've been booked for:
Job #${data.jobReference} — ${data.jobTitle}
Earnings: ${data.priceDisplay}
Client:   ${data.clientName}
Address:  ${data.propertyAddress}

Scope:
${data.scope}

Open the job in the app: ${data.reportUrl}

${partnerNotes ? `Important — before you start:\n${partnerNotes}\n\n` : ""}${PARTNER_JOB_EMAIL_NOTES_REPORT_DEADLINE}

Questions? ${supportEmail} / ${supportPhone}

Fixfy · www.getfixfy.com`;

  return { subject, html, text };
}

/**
 * "Please confirm this job within 24h".
 * Sent when OS directly assigns a partner to a job that did NOT come from
 * an approved bid (manual assignment). Includes an Accept link bound to
 * (jobId, partnerId). Partner clicks → POST /api/jobs/confirm-acceptance →
 * jobs.partner_confirmed_at stamped → booked email follows.
 */
export interface PartnerJobConfirmationRequestData {
  partnerFirstName: string;
  jobReference:     string;
  jobTitle:         string;
  clientName:       string;
  /** Partner-facing emails NEVER show the customer's phone — only name + address. */
  propertyAddress:  string;
  /** YYYY-MM-DD — used in the email subject line. */
  scheduledDate?:   string | null;
  scope:            string;
  /** £ display value (e.g. "£280.00"). */
  priceDisplay:     string;
  /** Tokenised accept URL — required. */
  acceptUrl:        string;
  /** Hours within which the partner is expected to accept. Default 24. */
  responseHours?:   number;
  /** Hourly/fixed + type-of-work rules shown before the Accept CTA. */
  partnerNotes?:    string | null;
  supportEmail?:    string;
  supportPhone?:    string;
}

export function buildPartnerJobConfirmationRequestEmail(
  data: PartnerJobConfirmationRequestData,
): { subject: string; html: string; text: string } {
  const supportEmail  = data.supportEmail  ?? "support@getfixfy.com";
  const supportPhone  = data.supportPhone  ?? "+44 20 4538 4668";
  const responseHours = data.responseHours ?? 24;
  const subject = partnerJobEmailSubject({
    kind: "offer",
    jobTitle: data.jobTitle,
    scheduledDate: data.scheduledDate,
    propertyAddress: data.propertyAddress,
  });

  const safe = {
    name:    escapeHtml(data.partnerFirstName || "there"),
    ref:     escapeHtml(data.jobReference),
    title:   escapeHtml(data.jobTitle),
    client:  escapeHtml(data.clientName),
    address: escapeHtml(data.propertyAddress),
    scope:   escapeHtml(data.scope),
    price:   escapeHtml(data.priceDisplay),
    accept:  escapeHtml(data.acceptUrl),
    hours:   String(responseHours),
    support: escapeHtml(supportEmail),
    supportTel:     escapeHtml(supportPhone),
    supportTelHref: telHref(supportPhone),
  };

  const partnerNotes = data.partnerNotes?.trim() || "";
  const notesBlock = partnerNotes ? partnerJobEmailNotesHtmlBlock(partnerNotes) : "";
  const reportDeadlineNote = escapeHtml(PARTNER_JOB_EMAIL_NOTES_REPORT_DEADLINE);

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en-GB"><head>
${partnerEmailHeadBlock()}
${partnerEmailBaseStyles()}
</head>
${partnerEmailBodyOpen()}
${partnerEmailPreheaderHtml(`Please confirm job ${safe.ref} within ${safe.hours} hours.`)}

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" bgcolor="#F7F7FB" style="background-color:#F7F7FB;">
  <tr><td align="center" style="padding: 32px 16px;">
    <table role="presentation" class="container email-card" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:600px; max-width:600px; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(2,0,64,0.08);">
      <tr><td bgcolor="#0B5FFF" style="background-color:#0B5FFF; padding:10px 40px; text-align:center;" class="px-mobile">
        <p style="margin:0; font-size:12px; font-weight:700; letter-spacing:0.6px; text-transform:uppercase; color:#FFFFFF;">⏱ Action required — respond within ${safe.hours} hours</p>
      </td></tr>
${partnerEmailLogoHeaderRow()}
      <tr><td style="padding:40px 40px 24px 40px;" class="px-mobile">
        <h1 class="h1-mobile" style="margin:0 0 12px 0; font-size:28px; line-height:36px; font-weight:700; color:#0A0A1F; letter-spacing:-0.5px;">Hi ${safe.name}, please confirm this job</h1>
        <p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#3A3A55;">We've allocated the job below to you. Tap <strong style="color:#0A0A1F;">Accept job</strong> within ${safe.hours} hours so we can confirm the booking with the customer.</p>
      </td></tr>
      <tr><td style="padding:0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#020040" style="background-color:#020040; border-radius:10px;">
          <tr><td bgcolor="#020040" style="padding:24px; background-color:#020040;">
            <p style="margin:0 0 4px 0; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#B8B8D0;">Your earnings</p>
            <p style="margin:0; font-size:32px; font-weight:700; color:#FFFFFF; letter-spacing:-1px;">${safe.price}</p>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:16px 40px 0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7F7FB; border:1px solid #E4E4EC; border-radius:10px;">
          <tr><td style="padding:24px;">
            <p style="margin:0 0 4px 0; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#6B6B85;">Job #${safe.ref}</p>
            <p style="margin:0 0 16px 0; font-size:18px; font-weight:600; color:#0A0A1F;">${safe.title}</p>
            <div style="border-top:1px solid #E4E4EC; padding-top:14px;">
              <p style="margin:0 0 4px 0; font-size:13px; color:#6B6B85;">Client</p>
              <p style="margin:0; font-size:14px; color:#0A0A1F; font-weight:500;">${safe.client}</p>
            </div>
            <div style="margin-top:14px; padding-top:14px; border-top:1px solid #E4E4EC;">
              <p style="margin:0 0 4px 0; font-size:13px; color:#6B6B85;">Address</p>
              <p style="margin:0; font-size:14px; line-height:21px; color:#0A0A1F; font-weight:500;">${safe.address}</p>
            </div>
            <div style="margin-top:14px; padding-top:14px; border-top:1px solid #E4E4EC;">
              <p style="margin:0 0 4px 0; font-size:13px; color:#6B6B85;">Scope of work</p>
              <p style="margin:0; font-size:14px; line-height:21px; color:#3A3A55; white-space:pre-wrap;">${safe.scope}</p>
            </div>
          </td></tr>
        </table>
      </td></tr>
      ${notesBlock}
      <tr><td align="center" style="padding:32px 40px 8px 40px;" class="px-mobile btn-mobile">
        <a href="${safe.accept}" target="_blank" style="display:inline-block; padding:16px 40px; background-color:#10B981; color:#FFFFFF; font-size:15px; font-weight:700; text-decoration:none; border-radius:8px;">✓ Accept job</a>
      </td></tr>
      <tr><td align="center" style="padding:0 40px 32px 40px;" class="px-mobile">
        <p style="margin:0 0 8px 0; font-size:13px; line-height:20px; color:#6B6B85;">${reportDeadlineNote}</p>
        <p style="margin:0; font-size:13px; line-height:20px; color:#6B6B85;">Can't take it? Reply to this email and we'll reallocate. Otherwise: <a href="mailto:${safe.support}" style="color:#ED4B00;">${safe.support}</a> · <a href="tel:${safe.supportTelHref}" style="color:#ED4B00;">${safe.supportTel}</a></p>
      </td></tr>
      <tr><td style="background-color:#F7F7FB; padding:20px 40px; border-top:1px solid #E4E4EC;" class="px-mobile">
        <p style="margin:0; font-size:12px; line-height:18px; color:#6B6B85;"><strong style="color:#3A3A55;">Fixfy</strong> · <a href="https://www.getfixfy.com" style="color:#6B6B85;">www.getfixfy.com</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const text =
`ACTION REQUIRED — RESPOND WITHIN ${responseHours} HOURS

Hi ${data.partnerFirstName || "there"},

We've allocated this job to you. Please confirm within ${responseHours} hours:

Job #${data.jobReference} — ${data.jobTitle}
Earnings: ${data.priceDisplay}
Client:   ${data.clientName}
Address:  ${data.propertyAddress}

Scope:
${data.scope}
${partnerNotes ? `\nImportant\n${partnerNotes}\n` : ""}
${PARTNER_JOB_EMAIL_NOTES_REPORT_DEADLINE}

Accept this job: ${data.acceptUrl}

Can't take it? Reply to this email and we'll reallocate.
Otherwise: ${supportEmail} / ${supportPhone}

Fixfy · www.getfixfy.com`;

  return { subject, html, text };
}

