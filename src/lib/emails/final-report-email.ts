/**
 * Copy 13: e-mail final só com o relatório (sem fatura), na moldura única.
 * Puro (sem banco, sem envio), para `final-review-email.ts` e as prévias.
 *
 * Não promete fatura depois (conta que não recebe fatura não pode ler isso) e
 * só diz "attached" quando algum arquivo do relatório foi de fato anexado.
 */
import { emailFixfy, FIXFY_CONTACT, saudacao, type EmailFixfy, type Publico } from "./fixfy-shell";
import { semTravessao } from "./billing-email-common";

export type FinalReportEmailInput = {
  publico: Publico;
  jobReference: string;
  service: string | null;
  propertyAddress: string | null;
  /** Quantos arquivos do relatório foram anexados. */
  reportAttachmentCount: number;
  /** O relatório foi pedido (sem arquivo = avisa que não foi anexado). */
  reportRequested: boolean;
  /** Certificado retido até o pagamento, ou liberado agora (`certificado/regra.ts`). */
  certificado?: "retido" | "liberado";
  /** Fotos do trabalho, link do report completo e o "What we did." (dono, 22/10/2026). */
  fotos?: EmailFixfy["fotos"];
  resumo?: EmailFixfy["resumo"];
  zendesk?: boolean;
};

/** Frase do certificado retido, a mesma no e-mail com e sem fatura. */
export const FRASE_CERTIFICADO_RETIDO = "Your certificate will be emailed to you as soon as the payment is received.";

export function buildFinalReportEmail(d: FinalReportEmailInput): { subject: string; preheader: string; html: string; text: string } {
  const service = semTravessao(d.service) || null;
  const property = semTravessao(d.propertyAddress) || null;
  const ref = String(d.jobReference ?? "").trim();
  const anexado = d.reportAttachmentCount > 0;
  const onde = property ? `The work at ${property} is complete` : "The work is complete";
  const p1 = anexado
    ? `${onde}, and your report is ready to view.`
    : d.reportRequested
      ? `${onde}. We couldn’t attach the report files to this email. Just reply and we’ll send you a copy.`
      : `${onde}.`;
  const preheader = anexado
    ? `The final report${service ? ` for ${service}` : ""} is attached.`
    : `${onde}.`;
  const liberado = d.certificado === "liberado";
  const subject = liberado
    ? `Your certificate · ${ref}`
    : anexado ? `Your job report is ready · ${ref}` : `Your job is complete · ${ref}`;
  const { html, text } = emailFixfy({
    preheader,
    estado: { texto: "Work complete", cor: "green" },
    titulo: liberado ? "Your certificate is ready" : anexado ? "Your job report is ready" : "Your job is complete",
    saudacao: saudacao(d.publico),
    paragrafos: [
      liberado ? "Thank you for your payment. Your certificate and final report are attached." : p1,
      ...(d.certificado === "retido" ? [FRASE_CERTIFICADO_RETIDO] : []),
      `Thank you for choosing Fixfy. If you have any questions about the work${anexado ? " or the report" : ""}, just reply or call us on ${FIXFY_CONTACT.phone}.`,
      "We’re happy to help.",
    ],
    linhas: [
      ["Service", service],
      ["Property", property],
      ["Booking", ref || null],
    ],
    fotos: d.fotos ?? null,
    resumo: d.resumo ?? null,
    zendesk: d.zendesk,
  });
  return { subject, preheader, html, text };
}
