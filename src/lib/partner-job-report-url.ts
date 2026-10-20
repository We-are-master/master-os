import { appBaseUrl } from "@/lib/app-base-url";
import { createPartnerReportToken, createVisitReportToken } from "@/lib/quote-response-token";
import { jobReportShortLinkEntityRef, upsertShortLink } from "@/lib/short-links";

/**
 * Canonical partner report URL: um link curto POR JOB (15/10/2026). O /r/ assina o
 * token no clique para o parceiro atual do job, então o link sobrevive a troca de
 * parceiro e a diferença de segredo entre ambientes. O token aqui só serve de alvo
 * de reserva se o encurtador falhar.
 * Used in Zendesk side conversations, Desk webhooks, booked emails and the office button.
 */
export async function buildPartnerJobReportUrl(jobId: string, partnerId: string): Promise<string> {
  const token = createPartnerReportToken(jobId, partnerId);
  const targetPath = `/job/report?token=${encodeURIComponent(token)}`;
  const base = appBaseUrl();
  try {
    const r = await upsertShortLink({
      targetPath,
      kind: "partner_report",
      entityRef: jobReportShortLinkEntityRef(jobId),
    });
    return `${base}${r.shortPath}`;
  } catch (err) {
    console.error("[partner-report-url] short link failed:", err);
    return `${base}${targetPath}`;
  }
}

/**
 * Link do relatório de UMA visita extra (19/10/2026), para o parceiro dela. Mesmo
 * formulário do job; o token diz qual visita. O /r/ reassina no clique.
 */
export async function buildVisitReportUrl(visitId: string, partnerId: string): Promise<string> {
  const token = createVisitReportToken(visitId, partnerId);
  const targetPath = `/job/report?token=${encodeURIComponent(token)}`;
  const base = appBaseUrl();
  try {
    const r = await upsertShortLink({
      targetPath,
      kind: "partner_visit_report",
      entityRef: `visit:${visitId}:partner:${partnerId}:report`,
    });
    return `${base}${r.shortPath}`;
  } catch (err) {
    console.error("[visit-report-url] short link failed:", err);
    return `${base}${targetPath}`;
  }
}
