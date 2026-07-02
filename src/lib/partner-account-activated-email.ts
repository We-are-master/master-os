import "server-only";
import type { CompanyBranding } from "@/lib/pdf/quote-template";
import {
  partnerEmailBaseStyles,
  partnerEmailBodyOpen,
  partnerEmailHeadBlock,
  partnerEmailPreheaderHtml,
  partnerEmailSplitTitleHtml,
} from "@/lib/emails/partner-email-layout";
import { appBaseUrl } from "@/lib/app-base-url";

export const PARTNER_ACCOUNT_ACTIVATED_SUBJECT = "You're live on Fixfy Trade";

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildPartnerAccountActivatedEmailHTML(
  branding: CompanyBranding,
  options: {
    contactName: string;
    email: string;
    loginUrl: string;
    /** Optional — if set, the email mentions the tier the admin chose at activation. */
    accountType?: "subscription" | "free" | null;
  },
): string {
  const companyName = branding.companyName?.trim() || "Fixfy";
  const supportEmail = branding.email?.trim() || "support@getfixfy.com";
  const nameRaw = options.contactName.trim();
  const firstName = nameRaw.split(/\s+/)[0] || "there";
  const loginUrl = options.loginUrl.trim();

  const safe = {
    firstName: escapeHtml(firstName),
    companyName: escapeHtml(companyName),
    supportEmail: escapeHtml(supportEmail),
    loginUrl: escapeHtml(loginUrl),
  };

  const tierChip =
    options.accountType === "subscription"
      ? `<span style="display:inline-block;background-color:#ED4B00;color:#FFFFFF;padding:5px 10px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">Subscription</span>`
      : options.accountType === "free"
        ? `<span style="display:inline-block;background-color:#0B5FFF;color:#FFFFFF;padding:5px 10px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">Free account</span>`
        : "";

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en-GB"><head>
${partnerEmailHeadBlock()}
${partnerEmailBaseStyles()}
</head>
${partnerEmailBodyOpen()}
${partnerEmailPreheaderHtml("Your Fixfy Trade account is now active. Sign in to start receiving jobs.")}

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" bgcolor="#F7F7FB" style="background-color:#F7F7FB;">
  <tr><td align="center" style="padding: 32px 16px;">
    <table role="presentation" class="container email-card" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:600px; max-width:600px; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(2,0,64,0.08);">

      <!-- Logo -->
      <tr><td style="padding:28px 40px 4px 40px;" class="px-mobile">
        <img src="${appBaseUrl()}/logos/fixfy-primary-navy.png" alt="Fixfy" width="132" style="display:block;height:auto;max-width:132px;border:0;outline:none;" />
      </td></tr>

      <!-- Title -->
      <tr><td style="padding:20px 40px 20px 40px;" class="px-mobile">
        ${partnerEmailSplitTitleHtml(safe.firstName, "You&#39;re live on Fixfy Trade &#127881;")}
        <p style="margin:0 0 8px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:24px; color:#3A3A55;">
          Great news — the ${safe.companyName} team just approved your onboarding. Your trade account is active
          and ready to receive work.
        </p>
        ${tierChip ? `<div style="margin:14px 0 0;">${tierChip}</div>` : ""}
      </td></tr>

      <!-- CTA button -->
      <tr><td style="padding:8px 40px 24px 40px;" class="px-mobile btn-mobile">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td align="center" bgcolor="#ED4B00" style="background-color:#ED4B00; border-radius:12px;">
              <a href="${safe.loginUrl}" target="_blank" style="display:inline-block; padding:14px 26px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; font-weight:700; color:#FFFFFF; text-decoration:none; letter-spacing:-0.02em;">
                Sign in to Fixfy Trade &rarr;
              </a>
            </td>
          </tr>
        </table>
        <p style="margin:12px 0 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; color:#6B6B85; word-break:break-all;">
          Or paste this link: <a href="${safe.loginUrl}" style="color:#ED4B00;">${safe.loginUrl}</a>
        </p>
      </td></tr>

      <!-- What's next -->
      <tr><td style="padding:0 40px 24px 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7F7FB; border:1px solid #E4E4EC; border-radius:10px;">
          <tr><td style="padding:20px 22px;">
            <p style="margin:0 0 10px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#020040;">
              What&#39;s unlocked now
            </p>
            <ul style="margin:0; padding-left:18px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:14px; line-height:22px; color:#0A0A1F;">
              <li>Browse and claim leads matching your trades &amp; coverage</li>
              <li>Send quotes and confirm jobs straight from the portal</li>
              <li>See your schedule, payouts and self-bills in one place</li>
            </ul>
          </td></tr>
        </table>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:0 40px 36px 40px;" class="px-mobile">
        <p style="margin:0 0 4px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; color:#3A3A55;">
          Any questions, hit reply — or email
          <a href="mailto:${safe.supportEmail}" style="color:#ED4B00;">${safe.supportEmail}</a>.
        </p>
        <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; color:#6B6B85;">
          Welcome aboard — ${safe.companyName} operations.
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>

</body></html>`;
}
