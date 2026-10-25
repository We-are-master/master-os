/**
 * Partner quote bid invitation email (Zendesk side conversation or Resend).
 *
 * O conteúdo do convite antigo (dono, 23/10/2026: o time gostava dele) na
 * moldura nova: saudação, o prazo num quadro âmbar, os detalhes com o escopo
 * inteiro (postcode e área, sem nome nem endereço do cliente até o job ser
 * dele), a lista do que o lance pede, as fotos, um botão e o quadro de dúvidas.
 */

import { linkParaBaixarFotos } from "@/lib/fotos-zip";
import { dataLonga, hora24 } from "@/lib/emails/fixfy-shell";
import {
  CHIP_PARCEIRO,
  PASSO_OFERTA,
  ajudaDoParceiro,
  areaDoEndereco,
  blocoDeFotosHtml,
  emailParceiro,
  passosDoJob,
  saudacaoDoParceiro,
  semFotosDoParceiro,
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
  return [dataLonga(deadline), hora24(deadline)].filter(Boolean).join(", ");
}

/**
 * MINIATURA no e-mail, galeria inteira no portal (ordem do dono, 07/09/2026).
 *
 * Até quatro fotos, grandes e lado a lado (dono, 25/10/2026; antes eram três
 * miniaturas). O clique abre a galeria da página de bid, e não o arquivo cru
 * no storage (reclamação dos parceiros em 27/08).
 */
function fotosDoConvite(photoUrls: string[], bidUrl: string, referencia: string): { html: string; text: string } {
  if (photoUrls.length === 0) return { html: "", text: "" };
  const galeria = `${bidUrl}#photos`;
  const MOSTRA = 4;
  const restantes = photoUrls.length - MOSTRA;
  const legenda = `Site photos: tap a photo to expand. All ${photoUrls.length} open in the partner portal.`;
  const baixarTudo = linkParaBaixarFotos(referencia, photoUrls);
  return {
    html: blocoDeFotosHtml(photoUrls, {
      legenda,
      max: MOSTRA,
      href: galeria,
      maisLink: { label: restantes > 0 ? `View more (+${restantes})` : "View more", url: galeria },
      baixarTudo,
    }),
    text: `${legenda}\n${photoUrls.map((u, i) => `${i + 1}. ${u}`).join("\n")}${baixarTudo ? `\nSave all photos: ${baixarTudo}` : ""}`,
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
  // Copy da versão antiga (dono, 23/10/2026: "usa a copy dos emails antigos").
  const subject = semTravessao(["Quote request", typeLabel, postcode].filter(Boolean).join(" · "));
  const preheader = semTravessao(`New opportunity: ${typeLabel}${postcode ? ` in ${postcode}` : ""}. Bid within ${PARTNER_QUOTE_BID_INVITE_EXPIRY_HOURS} hours.`);
  const fotos = fotosDoConvite(data.photoUrls, data.bidUrl, data.quoteReference);
  const escopo = String(data.scope ?? "")
    .split(/\n+/)
    .map((l) => semTravessao(l.trim()))
    .filter(Boolean)
    .join("\n");

  const lojas = [
    data.iosStoreUrl?.trim() ? { label: "App Store", url: data.iosStoreUrl.trim() } : null,
    data.androidStoreUrl?.trim() ? { label: "Google Play", url: data.androidStoreUrl.trim() } : null,
  ].filter((l): l is { label: string; url: string } => Boolean(l));

  const { html, text } = emailParceiro({
    preheader,
    estado: { texto: "New opportunity", cor: "navy", chip: true },
    titulo: "You have been invited to bid",
    saudacao: saudacaoDoParceiro(data.partnerFirstName),
    paragrafos: ["Review the details below and submit your quote before the deadline."],
    passos: passosDoJob(PASSO_OFERTA),
    avisos: [
      {
        tom: "amber",
        icone: "⏱",
        titulo: "Bid deadline",
        texto: `This quote expires in ${PARTNER_QUOTE_BID_INVITE_EXPIRY_HOURS} hours. Submit your bid by ${deadlineDisplay} (UK time).`,
        lugar: "topo",
      },
      {
        tom: "neutral",
        titulo: "Required to submit your bid",
        itens: [
          "Labour: fixed price or hourly (hours × rate)",
          "Materials: cost (enter £0 if none) and pricing type",
          "Two start date options: when you could begin the job",
        ],
        nota: "Use the button below. Incomplete bids cannot be submitted.",
      },
      ajudaDoParceiro(),
    ],
    // Postcode e área só: nome e endereço do cliente entram quando o job é dele.
    linhas: [
      ["Reference", data.quoteReference],
      ["Area", areaDoEndereco(data.propertyAddress)],
      ["Type of work", typeLabel],
      ["Bid window", `Expires in ${PARTNER_QUOTE_BID_INVITE_EXPIRY_HOURS} hours`],
      ["Scope", escopo || null],
    ],
    antesDoBotao: fotos.html ? fotos : semFotosDoParceiro(),
    cta: { label: "Submit your bid", url: data.bidUrl },
    linksSecundarios: [...lojas, { label: "View quote in Fixfy OS", url: data.officeQuoteUrl }],
  });
  return { subject, html, text };
}
