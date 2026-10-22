import "server-only";
import type { CompanyBranding } from "@/lib/pdf/quote-template";
import { emailFixfy } from "@/lib/emails/fixfy-shell";
import { passosDoCadastro, saudacaoDoParceiro } from "@/lib/emails/partner-shell";

export const PARTNER_ACCOUNT_ACTIVATED_SUBJECT = "Your Fixfy Trade account is active";

export function buildPartnerAccountActivatedEmail(
  branding: CompanyBranding,
  options: {
    /** Nome da saudação (vem de `partnerEmailGreetingName`: empresa antes do contato). */
    contactName: string;
    email: string;
    loginUrl: string;
    /** Optional — if set, the email mentions the tier the admin chose at activation. */
    accountType?: "subscription" | "free" | null;
  },
): { html: string; text: string } {
  const companyName = branding.companyName?.trim() || "Fixfy";
  const tier =
    options.accountType === "subscription" ? "Subscription" : options.accountType === "free" ? "Free account" : null;
  return emailFixfy({
    preheader: "Sign in to review offers, manage jobs and keep your availability up to date.",
    estado: { texto: "Active", cor: "green" },
    titulo: "Your account is active",
    passos: passosDoCadastro(2),
    saudacao: saudacaoDoParceiro(options.contactName),
    paragrafos: [
      `The ${companyName} team has approved your onboarding. Your trade account is active and ready to receive work.`,
      "What's unlocked now:",
      "· Browse and claim leads matching your trades & coverage",
      "· Send quotes and confirm jobs straight from the portal",
      "· See your schedule, payouts and self-bills in one place",
    ],
    linhas: [
      ["Account", options.email.trim() || null],
      ["Account type", tier],
    ],
    cta: { label: "Open Fixfy Trade", url: options.loginUrl.trim() },
    letraPequena: [
      "This button signs you in, no code needed. It works for 7 days, then sign in with your email as usual.",
      "Any questions, hit reply.",
      `Welcome aboard, ${companyName} operations.`,
    ],
  });
}

export function buildPartnerAccountActivatedEmailHTML(
  branding: CompanyBranding,
  options: Parameters<typeof buildPartnerAccountActivatedEmail>[1],
): string {
  return buildPartnerAccountActivatedEmail(branding, options).html;
}
