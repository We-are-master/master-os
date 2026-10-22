import "server-only";
import type { CompanyBranding } from "@/lib/pdf/quote-template";
import { emailFixfy } from "@/lib/emails/fixfy-shell";
import { passosDoCadastro, saudacaoDoParceiro, semTravessao } from "@/lib/emails/partner-shell";

const DEFAULT_SUPPORT_EMAIL = "support@getfixfy.com";

export const PARTNER_ONBOARDING_EMAIL_SUBJECT = "Complete your Fixfy Trade profile";

export interface PartnerOnboardingEmailOptions {
  contactName: string;
  email: string;
  onboardingUrl: string;
  /** Pre-filled login URL for partners who already started setup. */
  signInUrl?: string;
  customMessage?: string;
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

/**
 * O convite / lembrete de completar o cadastro. O modelo antigo
 * (email-templates/partner-onboarding-refresh.html) fica no repositório, sem uso:
 * desde 20/10/2026 o e-mail sai na moldura única.
 */
export function buildPartnerOnboardingRefreshEmail(
  branding: CompanyBranding,
  options: PartnerOnboardingEmailOptions,
): { html: string; text: string } {
  const supportEmail = branding.email?.trim() || DEFAULT_SUPPORT_EMAIL;
  const custom = options.customMessage?.trim() ? semTravessao(options.customMessage.trim()) : null;
  return emailFixfy({
    preheader: "Keep your Fixfy partner profile up to date. Log in to your portal to review your documents and details.",
    estado: { texto: "Partner account update", cor: "navy" },
    titulo: "Complete your Fixfy Trade profile",
    passos: passosDoCadastro(0),
    saudacao: saudacaoDoParceiro(options.contactName),
    paragrafos: [
      "Please review your profile, upload the required documents and check your payment details in Fixfy Trade. Up-to-date information helps us review your account and arrange payments.",
      ...(custom ? [custom] : []),
      "What to review:",
      "· Insurance, ID and trade certifications",
      "· Your contact details",
      "· Your payment details (managed securely inside your portal)",
      "Everything is updated inside your Fixfy portal, behind your secure login. We never ask you to send documents or bank details by email.",
    ],
    linhas: [
      ["Your account", options.contactName.trim() || null],
      ["Email", options.email.trim() || null],
    ],
    cta: { label: "Review your profile", url: options.onboardingUrl },
    linksSecundarios: [{ label: "Already started? Sign in", url: options.signInUrl?.trim() || options.onboardingUrl }],
    nota: `Staying safe: Fixfy will never ask for your password, bank details or documents by email or over the phone. If a message does, it isn't from us. Forward it to ${supportEmail}.`,
    letraPequena: ["You're receiving this because you're a registered Fixfy partner."],
  });
}

export function buildPartnerOnboardingRefreshEmailHTML(
  branding: CompanyBranding,
  options: PartnerOnboardingEmailOptions,
): string {
  return buildPartnerOnboardingRefreshEmail(branding, options).html;
}
