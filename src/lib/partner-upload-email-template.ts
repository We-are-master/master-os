/**
 * Branded HTML email for partner self-service document/profile upload links.
 * Moldura única (`emailFixfy`); tom e botão pensados para o parceiro.
 */

import type { CompanyBranding } from "@/lib/pdf/quote-template";
import { emailFixfy, dataLonga } from "@/lib/emails/fixfy-shell";
import { passosDoCadastro, saudacaoDoParceiro, semTravessao } from "@/lib/emails/partner-shell";

export interface PartnerUploadEmailOptions {
  partnerName: string;
  uploadUrl: string;
  expiresAt: Date;
  /** Optional admin-written message shown above the CTA. */
  customMessage?: string;
  /** Empty array → "any documents" wording; otherwise show the list. */
  requestedDocTypes?: string[];
  intro?: string;
  ctaLabel?: string;
  showDocList?: boolean;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  insurance: "Insurance certificate",
  certification: "Trade certifications",
  license: "License",
  contract: "Signed contract",
  tax: "Tax / VAT documents",
  id_proof: "Photo ID",
  other: "Other documents",
};

/**
 * Pedido de documentos ao parceiro, na moldura única (desde 20/10/2026).
 */
export function buildPartnerUploadEmail(
  _branding: CompanyBranding,
  options: PartnerUploadEmailOptions,
): { html: string; text: string } {
  const {
    partnerName,
    uploadUrl,
    expiresAt,
    customMessage,
    requestedDocTypes,
    intro = "We need to refresh the documents and details we hold for you. Please use the secure link below to upload your files and confirm your contact / bank information. No login needed.",
    ctaLabel = "Open secure upload page",
    showDocList = true,
  } = options;
  const docList = (requestedDocTypes ?? []).filter((t) => t && t.trim());
  const oQue = !showDocList
    ? []
    : docList.length > 0
      ? ["What we need:", ...docList.map((t) => `· ${DOC_TYPE_LABELS[t] ?? t}`)]
      : ["What we need: please upload any current documents we have on file (insurance, ID, certifications) and confirm your contact and bank details so we can keep paying you on time."];
  return emailFixfy({
    preheader: "Please update your documents with the secure link inside.",
    estado: { texto: "Documents needed", cor: "orange" },
    titulo: "Please update your documents",
    passos: passosDoCadastro(1),
    metricas: [{ rotulo: "Link expires", valor: dataLonga(expiresAt) ?? "" }],
    saudacao: saudacaoDoParceiro(partnerName),
    paragrafos: [semTravessao(intro), ...oQue],
    nota: customMessage?.trim() ? `Note from the team: ${semTravessao(customMessage.trim())}` : null,
    cta: { label: ctaLabel, url: uploadUrl },
    letraPequena: [`This link expires on ${dataLonga(expiresAt) ?? ""}.`, "If you didn't expect this email, you can safely ignore it."],
  });
}

export function buildPartnerUploadEmailHTML(
  branding: CompanyBranding,
  options: PartnerUploadEmailOptions,
): string {
  return buildPartnerUploadEmail(branding, options).html;
}
