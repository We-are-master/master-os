/**
 * Partner quote bid invitation email (Zendesk side conversation or Resend).
 *
 * Moldura única (`emailFixfy`, variante `zendesk: true`): prazo de 12 horas em
 * métrica, detalhes em duas colunas, miniaturas que abrem a galeria da página
 * de bid, um botão para dar o preço.
 */

import { emailFixfy, dataLonga, horaCurta } from "@/lib/emails/fixfy-shell";
import {
  MARCA_FOTOS,
  PASSO_OFERTA,
  blocoDeFotosHtml,
  comFotos,
  paragrafosDoEscopo,
  passosDoJob,
  saudacaoDoParceiro,
  semTravessao,
} from "@/lib/emails/partner-shell";
import { extractUkPostcode } from "@/lib/uk-postcode";

export const PARTNER_QUOTE_BID_INVITE_EXPIRY_HOURS = 12;

export interface PartnerQuoteBidInviteEmailData {
  partnerFirstName: string;
  quoteReference: string;
  typeOfWork: string;
  clientName: string;
  propertyAddress: string;
  scope: string;
  photoUrls: string[];
  bidUrl: string;
  deepLinkUrl: string;
  iosStoreUrl?: string | null;
  androidStoreUrl?: string | null;
  officeQuoteUrl: string;
  /** When the invite is sent — used to compute the 12h deadline shown in copy. */
  invitedAt?: Date;
  supportEmail?: string;
  supportPhone?: string;
}

function formatBidDeadline(invitedAt: Date): string {
  const deadline = new Date(invitedAt.getTime() + PARTNER_QUOTE_BID_INVITE_EXPIRY_HOURS * 60 * 60 * 1000);
  return [dataLonga(deadline), horaCurta(deadline)].filter(Boolean).join(", ");
}

/**
 * MINIATURA no e-mail, galeria inteira no portal (ordem do dono, 07/09/2026).
 *
 * Três miniaturas é o teto: mais que isso e o convite vira rolagem antes de o
 * parceiro chegar no botão de dar preço. O clique abre a galeria da página de
 * bid, e não o arquivo cru no storage (reclamação dos parceiros em 27/08).
 */
function fotosDoConvite(photoUrls: string[], bidUrl: string): { html: string; text: string } {
  if (photoUrls.length === 0) return { html: "", text: "" };
  const galeria = `${bidUrl}#photos`;
  const MOSTRA = 3;
  const restantes = photoUrls.length - MOSTRA;
  const legenda = `Site photos: tap a photo to expand. All ${photoUrls.length} open in the partner portal.`;
  return {
    html: blocoDeFotosHtml(photoUrls, {
      legenda,
      max: MOSTRA,
      href: galeria,
      maisLink: { label: restantes > 0 ? `View more (+${restantes})` : "View more", url: galeria },
    }),
    text: `${legenda}\n${photoUrls.map((u, i) => `${i + 1}. ${u}`).join("\n")}`,
  };
}

export function buildPartnerQuoteBidInviteEmail(data: PartnerQuoteBidInviteEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const invitedAt = data.invitedAt ?? new Date();
  const deadlineDisplay = formatBidDeadline(invitedAt);
  const postcode = extractUkPostcode(data.propertyAddress) ?? "";
  const typeLabel = data.typeOfWork.trim() || "Quote";
  const subject = semTravessao(["Quote request", typeLabel, postcode].filter(Boolean).join(" · "));
  const preheader = semTravessao(`New opportunity: ${data.typeOfWork} at ${data.propertyAddress || postcode || "your area"}. Bid within 12 hours.`);
  const fotos = fotosDoConvite(data.photoUrls, data.bidUrl);

  const lojas = [
    data.iosStoreUrl?.trim() ? { label: "App Store", url: data.iosStoreUrl.trim() } : null,
    data.androidStoreUrl?.trim() ? { label: "Google Play", url: data.androidStoreUrl.trim() } : null,
  ].filter((l): l is { label: string; url: string } => Boolean(l));

  const r = emailFixfy({
    zendesk: true,
    preheader,
    estado: { texto: "New opportunity", cor: "navy" },
    titulo: "You have been invited to bid on this opportunity",
    passos: passosDoJob(PASSO_OFERTA),
    metricas: [
      { rotulo: "Bid deadline", valor: deadlineDisplay, sub: "UK time" },
      { rotulo: "Bid window", valor: "12 hours" },
    ],
    saudacao: saudacaoDoParceiro(data.partnerFirstName),
    paragrafos: [
      "Review the details below and submit your quote before the deadline.",
      `This quote expires in 12 hours. Submit your bid by ${deadlineDisplay} (UK time).`,
      "Required to submit your bid:",
      "· Labour: fixed price or hourly (hours × rate)",
      "· Materials: cost (enter £0 if none) and pricing type",
      "· Two start date options: when you could begin the job",
      "Use the button below. Incomplete bids cannot be submitted.",
      ...paragrafosDoEscopo(data.scope, "Scope"),
      fotos.html ? MARCA_FOTOS : "No site photos were attached to this request.",
    ],
    linhas: [
      ["Reference", data.quoteReference],
      ["Type of work", typeLabel],
      ["Client", data.clientName.trim() || null],
      ["Postcode", postcode || null],
      ["Address", data.propertyAddress.trim() || null],
    ],
    cta: { label: "Submit your bid", url: data.bidUrl },
    linksSecundarios: [...lojas, { label: "View quote in Fixfy OS (office, login required)", url: data.officeQuoteUrl }],
    letraPequena: [
      `Or open in the Fixfy partner app: ${data.deepLinkUrl}`,
      ...(lojas.length
        ? []
        : ["Install Fixfy from the App Store or Google Play, sign in, then open Invites to view this request and submit your bid."]),
      "Questions? Reply to this email.",
    ],
  });
  const { html, text } = fotos.html ? comFotos(r, fotos.html, fotos.text) : r;
  return { subject, html, text };
}
