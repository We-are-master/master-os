/**
 * Copy 13: e-mail final só com o relatório (sem fatura), na moldura única.
 * Puro (sem banco, sem envio), para `final-review-email.ts` e as prévias.
 *
 * Não promete fatura depois (conta que não recebe fatura não pode ler isso) e
 * só diz "attached" quando algum arquivo do relatório foi de fato anexado.
 */
import { emailFixfy, FIXFY_CONTACT, saudacao, type Publico } from "./fixfy-shell";
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
  zendesk?: boolean;
};

export function buildFinalReportEmail(d: FinalReportEmailInput): { subject: string; preheader: string; html: string; text: string } {
  const service = semTravessao(d.service) || null;
  const property = semTravessao(d.propertyAddress) || null;
  const ref = String(d.jobReference ?? "").trim();
  const anexado = d.reportAttachmentCount > 0;
  const onde = property ? `The work at ${property} is complete` : "The work is complete";
  const p1 = anexado
    ? `${onde}, and your final report is attached for you to look through.`
    : d.reportRequested
      ? `${onde}. We couldn’t attach the report files to this email. Just reply and we’ll send you a copy.`
      : `${onde}.`;
  const preheader = anexado
    ? `The final report${service ? ` for ${service}` : ""} is attached.`
    : `${onde}.`;
  const subject = anexado ? `Your job report is ready · ${ref}` : `Your job is complete · ${ref}`;
  const { html, text } = emailFixfy({
    preheader,
    estado: { texto: "Work complete", cor: "green" },
    titulo: anexado ? "Your job report is ready" : "Your job is complete",
    saudacao: saudacao(d.publico),
    paragrafos: [
      p1,
      `Thank you for choosing Fixfy. If you have any questions about the work${anexado ? " or the report" : ""}, just reply or call us on ${FIXFY_CONTACT.phone}.`,
      "We’re happy to help.",
    ],
    linhas: [
      ["Service", service],
      ["Property", property],
      ["Booking", ref || null],
    ],
    zendesk: d.zendesk,
  });
  return { subject, preheader, html, text };
}
