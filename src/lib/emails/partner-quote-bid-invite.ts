/**
 * Partner quote bid invitation email (Zendesk side conversation or Resend).
 * Layout mirrors new_opportunity_1.html — no urgency row; 12-hour bid window callout.
 */

import { escapeHtmlAttr } from "@/lib/email-asset-url";
import {
  partnerEmailBaseStyles,
  partnerEmailBodyOpen,
  partnerEmailHeadBlock,
  partnerEmailLogoHeaderRow,
  partnerEmailLogoUrl,
  partnerEmailPreheaderHtml,
} from "@/lib/emails/partner-email-layout";
import { extractUkPostcode } from "@/lib/uk-postcode";

export const PARTNER_QUOTE_BID_INVITE_EXPIRY_HOURS = 12;

export interface PartnerQuoteBidInviteEmailData {
  partnerFirstName: string;
  quoteReference: string;
  typeOfWork: string;
  clientName: string;
  propertyAddress: string;
  scope: string;
  photoUrls: string[];
  bidUrl: string;
  deepLinkUrl: string;
  iosStoreUrl?: string | null;
  androidStoreUrl?: string | null;
  officeQuoteUrl: string;
  /** When the invite is sent — used to compute the 12h deadline shown in copy. */
  invitedAt?: Date;
  supportEmail?: string;
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

function formatBidDeadline(invitedAt: Date): string {
  const deadline = new Date(invitedAt.getTime() + PARTNER_QUOTE_BID_INVITE_EXPIRY_HOURS * 60 * 60 * 1000);
  return deadline.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  });
}

function infoRowDivider(): string {
  return `<tr class="info-row"><td colspan="2" style="border-top:1px solid #F2F0FA; line-height:0; font-size:0;">&nbsp;</td></tr>`;
}

function infoRow(label: string, valueHtml: string): string {
  return `<tr class="info-row">
  <td width="35%" valign="top" class="info-label" style="padding:12px 0 12px 20px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; font-weight:700; color:#9A9AA8; text-transform:uppercase; letter-spacing:1px;">${label}</td>
  <td valign="top" style="padding:12px 20px 12px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:14px; color:#1A1A1A; line-height:20px;">${valueHtml}</td>
</tr>`;
}

function buildPhotoSection(photoUrls: string[]): string {
  if (photoUrls.length === 0) {
    return `<tr><td class="px-mobile" style="padding:0 40px 24px 40px;">
      <p style="margin:0 0 12px 0; font-size:11px; font-weight:700; letter-spacing:2px; color:#020040; text-transform:uppercase;">SITE PHOTOS</p>
      <p style="margin:0; font-size:14px; line-height:22px; color:#4A4A55; font-style:italic;">No site photos were attached to this request.</p>
    </td></tr>`;
  }
  const imgs = photoUrls
    .map((u, i) => {
      const href = escapeHtmlAttr(u);
      const n = i + 1;
      return `<p style="margin:0 0 8px 0; font-size:13px;"><a href="${href}" style="color:#020040; font-weight:600;">Site photo ${n}</a></p>
<img src="${href}" alt="Site photo ${n}" width="520" style="display:block; max-width:100%; height:auto; border-radius:8px; border:1px solid #E8E8EE; margin-bottom:16px;" />`;
    })
    .join("");
  return `<tr><td class="px-mobile" style="padding:0 40px 24px 40px;">
    <p style="margin:0 0 12px 0; font-size:11px; font-weight:700; letter-spacing:2px; color:#020040; text-transform:uppercase;">SITE PHOTOS</p>
    ${imgs}
  </td></tr>`;
}

function buildStoreBlock(ios?: string | null, android?: string | null): string {
  const links: string[] = [];
  if (ios?.trim()) links.push(`<a href="${escapeHtmlAttr(ios.trim())}" style="color:#ED4B00; font-weight:600;">App Store</a>`);
  if (android?.trim()) links.push(`<a href="${escapeHtmlAttr(android.trim())}" style="color:#ED4B00; font-weight:600;">Google Play</a>`);
  if (links.length > 0) {
    return `<p style="margin:12px 0 0 0; font-size:13px; line-height:20px; color:#4A4A55;">${links.join(" &middot; ")}</p>`;
  }
  return `<p style="margin:12px 0 0 0; font-size:13px; line-height:20px; color:#4A4A55;">Install <strong>Fixfy</strong> from the App Store or Google Play, sign in, then open <strong>Invites</strong> to view this request and submit your bid.</p>`;
}

export function buildPartnerQuoteBidInviteEmail(data: PartnerQuoteBidInviteEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const supportEmail = data.supportEmail ?? "support@getfixfy.com";
  const supportPhone = data.supportPhone ?? "+44 20 4538 4668";
  const invitedAt = data.invitedAt ?? new Date();
  const deadlineDisplay = formatBidDeadline(invitedAt);
  const postcode = extractUkPostcode(data.propertyAddress) ?? "";
  const addressLine = escapeHtml(data.propertyAddress.trim() || "—");
  const postcodeLine = postcode ? `<br><span style="color:#4A4A55;">${escapeHtml(postcode)}</span>` : "";

  const typeLabel = data.typeOfWork.trim() || "Quote";
  const subject = `Quote Request: ${typeLabel} - ${postcode || "—"}`;
  const preheader = `New opportunity — ${data.typeOfWork} at ${data.propertyAddress || postcode || "your area"}. Bid within 12 hours.`;

  const safe = {
    name: escapeHtml(data.partnerFirstName || "there"),
    ref: escapeHtml(data.quoteReference),
    typeOfWork: escapeHtml(data.typeOfWork.trim() || "Quote"),
    client: escapeHtml(data.clientName.trim() || "—"),
    scope: escapeHtml(data.scope).replace(/\n/g, "<br/>"),
    bidUrl: escapeHtml(data.bidUrl),
    deepUrl: escapeHtml(data.deepLinkUrl),
    officeUrl: escapeHtml(data.officeQuoteUrl),
    deadline: escapeHtml(deadlineDisplay),
    support: escapeHtml(supportEmail),
    supportTel: escapeHtml(supportPhone),
    supportTelHref: telHref(supportPhone),
    logo: escapeHtml(partnerEmailLogoUrl()),
  };

  const scopeBlock = data.scope.trim()
    ? `<tr><td class="px-mobile" style="padding:0 40px 8px 40px;">
        <p style="margin:0 0 12px 0; font-size:11px; font-weight:700; letter-spacing:2px; color:#020040; text-transform:uppercase;">SCOPE</p>
      </td></tr>
      <tr><td class="px-mobile" style="padding:0 40px 24px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F7FA; border-radius:8px;">
          <tr><td style="padding:16px 18px; font-size:14px; line-height:22px; color:#1A1A1A;">${safe.scope}</td></tr>
        </table>
      </td></tr>`
    : "";

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en-GB"><head>
${partnerEmailHeadBlock()}
${partnerEmailBaseStyles()}
</head>
${partnerEmailBodyOpen()}
${partnerEmailPreheaderHtml(preheader)}

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" bgcolor="#F7F7FB" style="background-color:#F7F7FB;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" class="container email-card" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:600px; max-width:600px; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(2,0,64,0.06);">

${partnerEmailLogoHeaderRow("24px 24px 18px 24px")}
      <tr><td bgcolor="#ED4B00" style="background-color:#ED4B00; line-height:5px; font-size:5px; height:5px;" height="5">&nbsp;</td></tr>

      <tr><td class="px-mobile" style="padding:32px 40px 8px 40px;">
        <p style="margin:0; font-size:11px; font-weight:700; letter-spacing:3px; color:#ED4B00; text-transform:uppercase;">NEW OPPORTUNITY</p>
      </td></tr>
      <tr><td class="px-mobile" style="padding:0 40px 8px 40px;">
        <h1 class="h1-mobile" style="margin:0; font-size:26px; line-height:32px; font-weight:700; color:#020040;">Hi ${safe.name},</h1>
      </td></tr>
      <tr><td class="px-mobile" style="padding:0 40px 20px 40px;">
        <p style="margin:0; font-size:15px; line-height:24px; color:#4A4A55;">You have been invited to bid on this opportunity. Review the details below and submit your quote before the deadline.</p>
      </td></tr>

      <tr><td class="px-mobile" style="padding:0 40px 24px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFF7ED; border:1px solid #F3D9A4; border-radius:8px;">
          <tr><td style="padding:14px 18px;">
            <p style="margin:0 0 4px 0; font-size:12px; font-weight:700; color:#9A6B00; text-transform:uppercase; letter-spacing:0.5px;">Bid deadline</p>
            <p style="margin:0; font-size:14px; line-height:22px; color:#1A1A1A;"><strong style="color:#020040;">This quote expires in 12 hours.</strong> Submit your bid by <strong>${safe.deadline}</strong> (UK time).</p>
          </td></tr>
        </table>
      </td></tr>

      <tr><td class="px-mobile" style="padding:0 40px 8px 40px;">
        <p style="margin:0 0 12px 0; font-size:11px; font-weight:700; letter-spacing:2px; color:#020040; text-transform:uppercase;">OPPORTUNITY DETAILS</p>
      </td></tr>
      <tr><td class="px-mobile" style="padding:0 40px 24px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E8E8EE; border-radius:8px;">
          <tr>
            <td style="padding:18px 20px 14px 20px; border-bottom:1px solid #E8E8EE;">
              <p style="margin:0 0 4px 0; font-size:12px; color:#9A9AA8;">${safe.typeOfWork}</p>
              <p style="margin:0; font-size:18px; font-weight:700; color:#020040; line-height:24px;">${safe.client}</p>
            </td>
          </tr>
          ${infoRowDivider()}
          ${infoRow("Reference", `<span style="font-weight:600; color:#020040;">${safe.ref}</span>`)}
          ${infoRowDivider()}
          ${infoRow("Address", `${addressLine}${postcodeLine}`)}
          ${infoRowDivider()}
          ${infoRow("Type of work", safe.typeOfWork)}
          ${infoRowDivider()}
          ${infoRow(
            "Bid window",
            `<span style="display:inline-block; padding:4px 12px; background:#FBEFD6; color:#9A6B00; border-radius:12px; font-size:12px; font-weight:700; letter-spacing:0.5px;">Expires in 12 hours</span>`,
          )}
        </table>
      </td></tr>

${scopeBlock}
${buildPhotoSection(data.photoUrls)}

      <tr><td align="center" class="px-mobile btn-mobile" style="padding:8px 40px 8px 40px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
          <tr><td align="center" style="border-radius:10px; background-color:#ED4B00;">
            <a href="${safe.bidUrl}" target="_blank" style="display:inline-block; padding:16px 36px; font-size:16px; font-weight:700; color:#FFFFFF; text-decoration:none; border-radius:10px;">Submit your bid →</a>
          </td></tr>
        </table>
        <p style="margin:14px 0 0 0; font-size:12px; line-height:18px; color:#6B6B85;">Or open in the Fixfy partner app: <a href="${safe.deepUrl}" style="color:#ED4B00; font-weight:600;">in-app invitation</a></p>
        ${buildStoreBlock(data.iosStoreUrl, data.androidStoreUrl)}
        <p style="margin:16px 0 0 0; font-size:12px; line-height:18px; color:#9A9AAE;">Office link (login required): <a href="${safe.officeUrl}" style="color:#ED4B00;">View quote in Fixfy OS</a></p>
      </td></tr>

      <tr><td class="px-mobile" style="padding:8px 40px 32px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F0FA; border-radius:8px;">
          <tr><td style="padding:14px 18px;">
            <p style="margin:0 0 4px 0; font-size:12px; font-weight:700; color:#020040;">Questions?</p>
            <p style="margin:0; font-size:13px; line-height:20px; color:#4A4A55;">
              Reply to this email or message us at
              <a href="mailto:${safe.support}" style="color:#020040; font-weight:600; text-decoration:none;">${safe.support}</a>
              &middot; <a href="tel:${safe.supportTelHref}" style="color:#020040; font-weight:600; text-decoration:none;">${safe.supportTel}</a>
            </p>
          </td></tr>
        </table>
      </td></tr>

      <tr><td bgcolor="#020040" align="center" style="background-color:#020040; padding:24px 40px; text-align:center;" class="px-mobile">
        <img src="${safe.logo}" alt="Fixfy" width="70" style="display:inline-block; width:70px; max-width:70px; height:auto; margin-bottom:10px; border:0;" />
        <p style="margin:0; font-size:11px; line-height:18px; color:#AAAAD0;">
          Getfixfy Ltd &middot; Co. No. 15406523<br>
          124 City Road, London EC1V 2NX, United Kingdom<br>
          <a href="https://getfixfy.com" style="color:#AAAAD0; text-decoration:none;">getfixfy.com</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;

  const scopeText = data.scope.trim() ? `\nScope:\n${data.scope}\n` : "";
  const photosText =
    data.photoUrls.length > 0
      ? `\nSite photos:\n${data.photoUrls.map((u, i) => `${i + 1}. ${u}`).join("\n")}\n`
      : "\n(No site photos attached.)\n";

  const text =
    `NEW OPPORTUNITY — ${data.quoteReference}\n\n` +
    `Hi ${data.partnerFirstName || "there"},\n\n` +
    `You have been invited to bid. This quote expires in 12 hours — submit by ${deadlineDisplay} (UK time).\n\n` +
    `Reference: ${data.quoteReference}\n` +
    `Type of work: ${data.typeOfWork}\n` +
    `Client: ${data.clientName || "—"}\n` +
    `Address: ${data.propertyAddress || "—"}${postcode ? ` (${postcode})` : ""}\n` +
    scopeText +
    photosText +
    `\nSubmit your bid: ${data.bidUrl}\n` +
    `Partner app: ${data.deepLinkUrl}\n` +
    `Office: ${data.officeQuoteUrl}\n\n` +
    `Questions? ${supportEmail} · ${supportPhone}\n`;

  return { subject, html, text };
}
