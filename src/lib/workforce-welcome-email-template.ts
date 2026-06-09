import type { CompanyBranding } from "@/lib/pdf/quote-template";

export interface WorkforceWelcomeEmailOptions {
  personName: string;
  onboardingUrl: string;
  expiresAt: Date;
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

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function buildWorkforceWelcomeEmailHTML(
  branding: CompanyBranding,
  options: WorkforceWelcomeEmailOptions,
): string {
  const color = branding.primaryColor ?? "#ED4B00";
  const { personName, onboardingUrl, expiresAt, customMessage } = options;

  const messageBlock =
    customMessage && customMessage.trim()
      ? `<p style="margin:0 0 16px;font-size:14px;color:#57534E;line-height:1.6;">${escapeHtml(customMessage.trim())}</p>`
      : "";

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F5F5F4;font-family:system-ui,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E7E5E4;">
<tr><td style="background:${color};padding:24px;text-align:center;">
<h1 style="margin:0;color:#fff;font-size:20px;">Welcome to ${escapeHtml(branding.companyName)}</h1>
</td></tr>
<tr><td style="padding:28px 24px;">
<p style="margin:0 0 12px;font-size:15px;color:#1C1917;">Hi ${escapeHtml(personName)},</p>
<p style="margin:0 0 16px;font-size:14px;color:#57534E;line-height:1.6;">
  Complete your onboarding to confirm your profile, upload documents, and review your payment terms (fixed pay and commission, if applicable).
</p>
${messageBlock}
<p style="margin:0 0 20px;text-align:center;">
<a href="${escapeHtml(onboardingUrl)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;">Complete onboarding</a>
</p>
<p style="margin:0;font-size:12px;color:#78716C;">Link expires ${formatDate(expiresAt)}.</p>
</td></tr>
</table>
</td></tr></table></body></html>`;
}
