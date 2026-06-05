import { appBaseUrl } from "@/lib/app-base-url";
import { createPartnerReportToken } from "@/lib/quote-response-token";
import { jobPartnerShortLinkEntityRef, upsertShortLink } from "@/lib/short-links";

/**
 * Canonical partner report URL — tokenised OS link (shortened when possible).
 * Used in Zendesk side conversations, Desk webhooks, and booked emails.
 */
export async function buildPartnerJobReportUrl(jobId: string, partnerId: string): Promise<string> {
  const token = createPartnerReportToken(jobId, partnerId);
  const targetPath = `/job/report?token=${encodeURIComponent(token)}`;
  const base = appBaseUrl();
  try {
    const r = await upsertShortLink({
      targetPath,
      kind: "partner_report",
      entityRef: jobPartnerShortLinkEntityRef(jobId, partnerId, "report"),
    });
    return `${base}${r.shortPath}`;
  } catch (err) {
    console.error("[partner-report-url] short link failed:", err);
    return `${base}${targetPath}`;
  }
}
