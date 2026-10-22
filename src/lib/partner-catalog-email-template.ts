import { emailFixfy } from "@/lib/emails/fixfy-shell";
import { saudacaoDoParceiro, semTravessao } from "@/lib/emails/partner-shell";

export type PartnerCatalogEmailInput = {
  recipientName?: string;
  message?: string;
  liveUrl: string;
  pdfUrl: string;
  companyName: string;
  logoUrl: string;
};

/**
 * A tabela de preços de parceiro (rate card), na moldura única desde
 * 20/10/2026. O modelo antigo (email-templates/partner-catalog-share.html)
 * fica no repositório, sem uso. O PDF segue anexado por quem envia.
 */
export function buildPartnerCatalogEmail(input: PartnerCatalogEmailInput): { html: string; text: string } {
  const pdf = input.pdfUrl?.trim() || null;
  return emailFixfy({
    preheader: "We've updated our partner rates across trades, certificates and specialist services.",
    estado: { texto: "Partner rates", cor: "navy" },
    titulo: "Welcome aboard!",
    saudacao: saudacaoDoParceiro(input.recipientName),
    paragrafos: [
      "We've updated our partner rates across trades, certificates and specialist services.",
      "View the latest rates, payment structure and available opportunities on the Fixfy network.",
      "Why work with Fixfy?",
      "· Pre-qualified customers",
      "· Commercial & residential work",
      "· Fast approvals",
      "· Weekly or scheduled payments",
      "· No quoting required on selected jobs",
      "· Opportunities across London",
      "· Dedicated partner support",
    ],
    nota: input.message?.trim() ? semTravessao(input.message.trim()) : null,
    cta: { label: "View Partner Rates", url: input.liveUrl },
    linksSecundarios: [
      ...(pdf ? [{ label: "Download the rate card PDF", url: pdf }] : []),
      { label: "partners.getfixfy.com", url: "https://partners.getfixfy.com" },
    ],
    letraPequena: [pdf ? "A PDF copy is attached." : "A PDF copy of the partner rate card is attached to this email."],
  });
}

export function buildPartnerCatalogEmailHTML(input: PartnerCatalogEmailInput): string {
  return buildPartnerCatalogEmail(input).html;
}
