import "server-only";
import { readFileSync } from "fs";
import { join } from "path";
import type { CompanyBranding } from "@/lib/pdf/quote-template";

const DEFAULT_LOGO_URL = "https://www.getfixfy.com/brand/fixfy-primary-white.png";
const DEFAULT_SUPPORT_EMAIL = "support@getfixfy.com";

export const PARTNER_ONBOARDING_EMAIL_SUBJECT = "Welcome to the Fixfy Partner Portal";

export interface PartnerOnboardingEmailOptions {
  contactName: string;
  email: string;
  onboardingUrl: string;
  customMessage?: string;
}

let cachedTemplate: string | null = null;

function loadPartnerOnboardingRefreshTemplate(): string {
  if (cachedTemplate) return cachedTemplate;
  cachedTemplate = readFileSync(
    join(process.cwd(), "src/lib/email-templates/partner-onboarding-refresh.html"),
    "utf8",
  );
  return cachedTemplate;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function firstName(fullName: string): string {
  const t = fullName.trim();
  if (!t) return "there";
  return t.split(/\s+/)[0] ?? t;
}

function replaceAll(template: string, key: string, value: string): string {
  return template.split(`{{${key}}}`).join(value);
}

export function resolvePartnerTradeLabel(partner: {
  trade?: string | null;
  trades?: string[] | null;
}): string {
  const trades =
    partner.trades?.filter((t): t is string => typeof t === "string" && t.trim().length > 0) ?? [];
  if (trades.length > 0) return trades.join(", ");
  return partner.trade?.trim() || "General";
}

export function buildPartnerOnboardingRefreshEmailHTML(
  branding: CompanyBranding,
  options: PartnerOnboardingEmailOptions,
): string {
  const companyName = branding.companyName?.trim() || "Getfixfy Ltd";
  const supportEmail = branding.email?.trim() || DEFAULT_SUPPORT_EMAIL;
  const logoUrl = branding.logoUrl?.trim() || DEFAULT_LOGO_URL;
  const contactName = options.contactName.trim() || "there";

  const customMessageBlock =
    options.customMessage && options.customMessage.trim()
      ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#333;white-space:pre-wrap;">${escapeHtml(options.customMessage.trim())}</p>`
      : "";

  let html = loadPartnerOnboardingRefreshTemplate();
  html = replaceAll(html, "logo_url", escapeHtml(logoUrl));
  html = replaceAll(html, "partner_first_name", escapeHtml(firstName(contactName)));
  html = replaceAll(html, "partner_name", escapeHtml(contactName));
  html = replaceAll(html, "partner_email", escapeHtml(options.email.trim()));
  html = replaceAll(html, "onboarding_url", escapeHtml(options.onboardingUrl));
  html = replaceAll(html, "support_email", escapeHtml(supportEmail));
  html = replaceAll(html, "company_name", escapeHtml(companyName));
  html = replaceAll(html, "company_address", escapeHtml(branding.address?.trim() || "124 City Road, London EC1V 2NX, United Kingdom"));
  html = replaceAll(html, "custom_message_block", customMessageBlock);

  return html;
}
