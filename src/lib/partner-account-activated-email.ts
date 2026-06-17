import "server-only";
import type { CompanyBranding } from "@/lib/pdf/quote-template";

export const PARTNER_ACCOUNT_ACTIVATED_SUBJECT = "Your Fixfy Trade account is now active";

export function buildPartnerAccountActivatedEmailHTML(
  branding: CompanyBranding,
  options: { contactName: string; email: string; loginUrl: string },
): string {
  const companyName = branding.companyName?.trim() || "Fixfy";
  const supportEmail = branding.email?.trim() || "support@getfixfy.com";
  const name = options.contactName.trim() || "there";
  const loginUrl = options.loginUrl.trim();

  return `<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; line-height: 1.55; margin: 0; padding: 24px;">
  <p>Hi ${escapeHtml(name)},</p>
  <p>Good news — your ${escapeHtml(companyName)} Trade account has been approved. You can now sign in and start receiving jobs.</p>
  <p style="margin: 24px 0;">
    <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#ED4B00;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">
      Sign in to Fixfy Trade
    </a>
  </p>
  <p style="font-size: 14px; color: #555;">Or copy this link: ${escapeHtml(loginUrl)}</p>
  <p style="font-size: 14px; color: #555; margin-top: 24px;">Questions? Reply to this email or contact ${escapeHtml(supportEmail)}.</p>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
