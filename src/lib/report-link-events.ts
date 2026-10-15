/**
 * Registro do caminho do report do parceiro (mig 332). Nunca derruba quem chama:
 * se a tabela ainda não existe ou a gravação falha, só vai para o console.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ReportLinkEvent =
  | "open"
  | "open_refused"
  | "upload_url"
  | "upload_refused"
  | "submit"
  | "submit_refused";

export async function registrarReportLink(
  sb: SupabaseClient,
  e: { jobId?: string | null; partnerId?: string | null; event: ReportLinkEvent; ok?: boolean; detail?: string | null; meta?: Record<string, unknown> },
): Promise<void> {
  try {
    const { error } = await sb.from("report_link_events").insert({
      job_id: e.jobId ?? null,
      partner_id: e.partnerId ?? null,
      event: e.event,
      ok: e.ok ?? true,
      detail: e.detail ?? null,
      meta: e.meta ?? {},
    });
    if (error) console.warn("[report-link-events]", error.message);
  } catch (err) {
    console.warn("[report-link-events]", err);
  }
}
