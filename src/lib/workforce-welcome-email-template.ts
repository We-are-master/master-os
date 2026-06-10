import "server-only";
import { readFileSync } from "fs";
import { join } from "path";
import type { CompanyBranding } from "@/lib/pdf/quote-template";

const DEFAULT_LOGO_URL = "https://www.getfixfy.com/brand/fixfy-primary-white.png";
const DEFAULT_SUPPORT_EMAIL = "support@getfixfy.com";

export type WorkforceWelcomeEmailVariant = "onboarding" | "platform_login";

export interface WorkforceWelcomeEmailOptions {
  personName: string;
  workEmail: string;
  role: string;
  /** CTA target — onboarding link or `/login?email=…` for platform access. */
  actionUrl: string;
  /** @deprecated Use actionUrl */
  onboardingUrl?: string;
  customMessage?: string;
  variant?: WorkforceWelcomeEmailVariant;
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

function onboardingEmailBlocks(companyName: string, first: string): {
  preheader: string;
  intro: string;
  ctaLabel: string;
  expiryBlock: string;
  whatsNextBlock: string;
} {
  return {
    preheader: `Welcome to ${companyName}, ${first}! Complete your onboarding. Link expires in 24 hours.`,
    intro:
      "Please complete your onboarding — confirm your profile, add bank details, upload required documents, review your payment terms, and sign your contract. It only takes a few minutes.",
    ctaLabel: "Complete Your Onboarding →",
    expiryBlock: `<p style="margin:0; padding:0; font-size:12px; color:#9A9AA8;">
                🕒 This link expires in <strong style="color:#020040;">24 hours</strong> for security.
              </p>`,
    whatsNextBlock: `<p style="margin:0 0 6px 0; padding:0; font-size:11px; font-weight:700; letter-spacing:2px; color:#020040; text-transform:uppercase;">
                What's Next
              </p>
              <p style="margin:0 0 18px 0; padding:0; font-size:14px; color:#4A4A55; line-height:21px;">
                On the onboarding portal, complete these steps:
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr class="step-row">
                  <td valign="top" width="44" class="step-num" style="padding:0 14px 16px 0;">
                    <span style="display:inline-block; width:30px; height:30px; line-height:30px; text-align:center; background:#020040; color:#fff; border-radius:50%; font-size:13px; font-weight:700;">1</span>
                  </td>
                  <td valign="top" style="padding:0 0 16px 0;">
                    <p style="margin:0 0 3px 0; font-size:15px; font-weight:700; color:#020040; line-height:21px;">
                      Confirm your details &amp; bank account
                    </p>
                    <p style="margin:0; font-size:13px; color:#4A4A55; line-height:20px;">
                      Review your profile, contact info, and UK bank details for payments in GBP.
                    </p>
                  </td>
                </tr>
                <tr class="step-row">
                  <td valign="top" width="44" class="step-num" style="padding:0 14px 16px 0;">
                    <span style="display:inline-block; width:30px; height:30px; line-height:30px; text-align:center; background:#020040; color:#fff; border-radius:50%; font-size:13px; font-weight:700;">2</span>
                  </td>
                  <td valign="top" style="padding:0 0 16px 0;">
                    <p style="margin:0 0 3px 0; font-size:15px; font-weight:700; color:#020040; line-height:21px;">
                      Upload required documents
                    </p>
                    <p style="margin:0; font-size:13px; color:#4A4A55; line-height:20px;">
                      Submit ID and any compliance files listed for your role (employee or contractor).
                    </p>
                  </td>
                </tr>
                <tr class="step-row">
                  <td valign="top" width="44" class="step-num" style="padding:0 14px 0 0;">
                    <span style="display:inline-block; width:30px; height:30px; line-height:30px; text-align:center; background:#ED4B00; color:#fff; border-radius:50%; font-size:13px; font-weight:700;">3</span>
                  </td>
                  <td valign="top" style="padding:0;">
                    <p style="margin:0 0 3px 0; font-size:15px; font-weight:700; color:#020040; line-height:21px;">
                      Sign your contract digitally
                    </p>
                    <p style="margin:0; font-size:13px; color:#4A4A55; line-height:20px;">
                      Read and sign your employment or service agreement — saved automatically on our side.
                    </p>
                  </td>
                </tr>
              </table>`,
  };
}

function platformLoginEmailBlocks(companyName: string, first: string): {
  preheader: string;
  intro: string;
  ctaLabel: string;
  expiryBlock: string;
  whatsNextBlock: string;
} {
  return {
    preheader: `${first}, your ${companyName} OS account is ready — sign in to get started.`,
    intro:
      "You're all set on our side. Sign in to the Fixfy Operating System with your work email to access jobs, schedule, and the tools for your role.",
    ctaLabel: "Sign in to Fixfy OS →",
    expiryBlock: `<p style="margin:0; padding:0; font-size:12px; color:#9A9AA8; line-height:18px;">
                Use your work email below. If you were given a temporary password, you&apos;ll choose a new one on first login.
              </p>`,
    whatsNextBlock: `<p style="margin:0 0 6px 0; padding:0; font-size:11px; font-weight:700; letter-spacing:2px; color:#020040; text-transform:uppercase;">
                What's Next
              </p>
              <p style="margin:0 0 18px 0; padding:0; font-size:14px; color:#4A4A55; line-height:21px;">
                Get into the OS in three quick steps:
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr class="step-row">
                  <td valign="top" width="44" class="step-num" style="padding:0 14px 16px 0;">
                    <span style="display:inline-block; width:30px; height:30px; line-height:30px; text-align:center; background:#020040; color:#fff; border-radius:50%; font-size:13px; font-weight:700;">1</span>
                  </td>
                  <td valign="top" style="padding:0 0 16px 0;">
                    <p style="margin:0 0 3px 0; font-size:15px; font-weight:700; color:#020040; line-height:21px;">
                      Open the sign-in link
                    </p>
                    <p style="margin:0; font-size:13px; color:#4A4A55; line-height:20px;">
                      Tap the button above — your work email is pre-filled on the login page.
                    </p>
                  </td>
                </tr>
                <tr class="step-row">
                  <td valign="top" width="44" class="step-num" style="padding:0 14px 16px 0;">
                    <span style="display:inline-block; width:30px; height:30px; line-height:30px; text-align:center; background:#020040; color:#fff; border-radius:50%; font-size:13px; font-weight:700;">2</span>
                  </td>
                  <td valign="top" style="padding:0 0 16px 0;">
                    <p style="margin:0 0 3px 0; font-size:15px; font-weight:700; color:#020040; line-height:21px;">
                      Enter your password
                    </p>
                    <p style="margin:0; font-size:13px; color:#4A4A55; line-height:20px;">
                      Use the password you chose during setup, or the temporary password your admin shared.
                    </p>
                  </td>
                </tr>
                <tr class="step-row">
                  <td valign="top" width="44" class="step-num" style="padding:0 14px 0 0;">
                    <span style="display:inline-block; width:30px; height:30px; line-height:30px; text-align:center; background:#ED4B00; color:#fff; border-radius:50%; font-size:13px; font-weight:700;">3</span>
                  </td>
                  <td valign="top" style="padding:0;">
                    <p style="margin:0 0 3px 0; font-size:15px; font-weight:700; color:#020040; line-height:21px;">
                      Start using the OS
                    </p>
                    <p style="margin:0; font-size:13px; color:#4A4A55; line-height:20px;">
                      You&apos;ll land in ${escapeHtml(companyName)}&apos;s dashboard — jobs, schedule, and your team tools.
                    </p>
                  </td>
                </tr>
              </table>`,
  };
}

export function buildWorkforceWelcomeEmailHTML(
  branding: CompanyBranding,
  options: WorkforceWelcomeEmailOptions,
): string {
  const companyName = branding.companyName?.trim() || "Fixfy";
  const supportEmail = branding.email?.trim() || DEFAULT_SUPPORT_EMAIL;
  const logoUrl = branding.logoUrl?.trim() || DEFAULT_LOGO_URL;
  const fullName = options.personName.trim() || "there";
  const variant = options.variant ?? "onboarding";
  const actionUrl = options.actionUrl ?? options.onboardingUrl ?? "";
  const fn = firstName(fullName);

  const blocks =
    variant === "platform_login"
      ? platformLoginEmailBlocks(companyName, fn)
      : onboardingEmailBlocks(companyName, fn);

  const customMessageBlock =
    options.customMessage && options.customMessage.trim()
      ? `<p style="margin:16px 0 0;padding:0;font-size:14px;color:#4A4A55;line-height:24px;">${escapeHtml(options.customMessage.trim())}</p>`
      : "";

  let html = loadWelcomeTeamMemberTemplate();
  html = replaceAll(html, "company_name", escapeHtml(companyName));
  html = replaceAll(html, "first_name", escapeHtml(fn));
  html = replaceAll(html, "full_name", escapeHtml(fullName));
  html = replaceAll(html, "email", escapeHtml(options.workEmail));
  html = replaceAll(html, "role", escapeHtml(options.role));
  html = replaceAll(html, "setup_url", escapeHtml(actionUrl));
  html = replaceAll(html, "logo_url", escapeHtml(logoUrl));
  html = replaceAll(html, "support_email", escapeHtml(supportEmail));
  html = replaceAll(html, "custom_message_block", customMessageBlock);
  html = replaceAll(html, "preheader_text", escapeHtml(blocks.preheader));
  html = replaceAll(html, "intro_paragraph", escapeHtml(blocks.intro));
  html = replaceAll(html, "cta_label", escapeHtml(blocks.ctaLabel));
  html = replaceAll(html, "expiry_block", blocks.expiryBlock);
  html = replaceAll(html, "whats_next_block", blocks.whatsNextBlock);

  return html;
}
