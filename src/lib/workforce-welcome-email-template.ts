import "server-only";
import { readFileSync } from "fs";
import { join } from "path";
import type { CompanyBranding } from "@/lib/pdf/quote-template";

const DEFAULT_LOGO_URL = "https://www.getfixfy.com/brand/fixfy-primary-white.png";
const DEFAULT_SUPPORT_EMAIL = "support@getfixfy.com";

export interface WorkforceWelcomeEmailOptions {
  personName: string;
  workEmail: string;
  role: string;
  onboardingUrl: string;
  customMessage?: string;
}

let cachedTemplate: string | null = null;

function loadWelcomeTeamMemberTemplate(): string {
  if (cachedTemplate) return cachedTemplate;
  cachedTemplate = readFileSync(
    join(process.cwd(), "src/lib/email-templates/welcome-team-member.html"),
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

export function formatWorkforceWelcomeRole(
  employmentType: string | null | undefined,
  description: string | null | undefined,
): string {
  const base = employmentType === "self_employed" ? "Contractor" : "Employee";
  const desc = description?.trim();
  if (desc) return `${base} · ${desc}`;
  return base;
}

function replaceAll(template: string, key: string, value: string): string {
  return template.split(`{{${key}}}`).join(value);
}

export function buildWorkforceWelcomeEmailHTML(
  branding: CompanyBranding,
  options: WorkforceWelcomeEmailOptions,
): string {
  const companyName = branding.companyName?.trim() || "Fixfy";
  const supportEmail = branding.email?.trim() || DEFAULT_SUPPORT_EMAIL;
  const logoUrl = branding.logoUrl?.trim() || DEFAULT_LOGO_URL;
  const fullName = options.personName.trim() || "there";

  const customMessageBlock =
    options.customMessage && options.customMessage.trim()
      ? `<p style="margin:16px 0 0;padding:0;font-size:14px;color:#4A4A55;line-height:24px;">${escapeHtml(options.customMessage.trim())}</p>`
      : "";

  let html = loadWelcomeTeamMemberTemplate();
  html = replaceAll(html, "company_name", escapeHtml(companyName));
  html = replaceAll(html, "first_name", escapeHtml(firstName(fullName)));
  html = replaceAll(html, "full_name", escapeHtml(fullName));
  html = replaceAll(html, "email", escapeHtml(options.workEmail));
  html = replaceAll(html, "role", escapeHtml(options.role));
  html = replaceAll(html, "setup_url", escapeHtml(options.onboardingUrl));
  html = replaceAll(html, "logo_url", escapeHtml(logoUrl));
  html = replaceAll(html, "support_email", escapeHtml(supportEmail));
  html = replaceAll(html, "custom_message_block", customMessageBlock);

  return html;
}
