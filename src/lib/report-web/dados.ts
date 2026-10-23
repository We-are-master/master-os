import "server-only";

/**
 * O report do job na web (dono, 23/10/2026: "um portal que abre o report ao invés de PDF").
 *
 * O PDF não comporta um job de 100 fotos: polui e fica pesado para mandar. A página
 * /report/[token] mostra o mesmo report (o mesmo filtro do que vai ao cliente,
 * report-cliente.ts) com TODAS as fotos, por cômodo, e o PDF continua como download.
 *
 * Fonte: start_report e final_report do job (as mesmas do PDF V2), fotos no bucket
 * job-reports com URL assinada que vale 6 h (a página é dinâmica: cada visita assina
 * de novo). Token: o mesmo link assinado do relatório da fatura semanal.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeReport } from "@/lib/job-report-v2";
import { gruposDoReport } from "@/lib/report-web/grupos";
import { jobReportPdfPathFromStoredUrl } from "@/services/job-reports";
import { certificateAttachmentUrls } from "@/lib/certificate-expiry";
import { materialDoJobInteiro } from "@/lib/report-material-extra";
import { dataCurta, linhasDoCliente, textoDe, type Linha } from "@/lib/report-cliente";

const BUCKET = "job-reports";
const VALIDADE_S = 6 * 60 * 60;

export type FotoWeb = { src: string; rotulo: string | null };
export type GrupoDeFotos = { rotulo: string; fotos: FotoWeb[] };

export type ReportWeb = {
  referencia: string;
  titulo: string;
  endereco: string;
  estado: "Complete" | "Partly complete" | "In progress";
  concluidoEm: string | null;
  visitas: string[];
  resumo: string | null;
  detalhes: Linha[];
  naChegada: Linha[];
  antes: GrupoDeFotos[];
  depois: GrupoDeFotos[];
  totalDeFotos: number;
};

async function assinar(admin: SupabaseClient, grupos: Array<{ rotulo: string; urls: string[] }>): Promise<GrupoDeFotos[]> {
  const caminhos = [...new Set(grupos.flatMap((g) => g.urls.map((u) => jobReportPdfPathFromStoredUrl(u) ?? u)))];
  if (caminhos.length === 0) return [];
  const { data } = await admin.storage.from(BUCKET).createSignedUrls(caminhos, VALIDADE_S);
  const assinada = new Map((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl]));
  return grupos
    .map((g) => ({
      rotulo: g.rotulo,
      fotos: g.urls
        .map((u) => assinada.get(jobReportPdfPathFromStoredUrl(u) ?? u))
        .filter((src): src is string => Boolean(src))
        .map((src) => ({ src, rotulo: g.rotulo })),
    }))
    .filter((g) => g.fotos.length > 0);
}

export async function carregarReportWeb(admin: SupabaseClient, jobId: string): Promise<ReportWeb | null> {
  const { data: job } = await admin
    .from("jobs")
    .select("id, reference, title, property_address, scheduled_date, start_report, final_report")
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!job) return null;

  const start = normalizeReport(job.start_report);
  const final = normalizeReport(job.final_report);
  if (!start && !final) return null;

  // Material que o cliente paga, uma vez, somado (mesma regra do PDF).
  if (final) {
    const material = await materialDoJobInteiro(admin, jobId, job.final_report as Record<string, unknown> | null);
    delete final.fields.materials_extra_cost;
    delete final.fields.materials_receipt;
    if (material.charge > 0) final.fields.materials_extra_charge = material.charge;
  }

  // O certificado é documento à parte, não foto do report.
  const doCertificado = new Set(certificateAttachmentUrls(job.final_report));

  const { data: visitas } = await admin
    .from("job_visits")
    .select("scheduled_start_at, status")
    .eq("job_id", jobId)
    .is("deleted_at", null)
    .order("scheduled_start_at");
  const datas = [job.scheduled_date ? new Date(`${job.scheduled_date}T12:00:00Z`) : null, ...(visitas ?? []).filter((v) => v.status !== "cancelled").map((v) => (v.scheduled_start_at ? new Date(v.scheduled_start_at) : null))]
    .map((d) => dataCurta(d))
    .filter((d): d is string => Boolean(d));

  const status = typeof final?.fields?.completion_status === "string" ? String(final.fields.completion_status) : null;
  const parcial = status === "partially_complete" || status === "not_complete" || status === "incomplete";
  const resumo = textoDe(final ?? undefined, "description") ?? textoDe(final ?? undefined, "inspection_summary");

  const [antes, depois] = await Promise.all([assinar(admin, gruposDoReport(start)), assinar(admin, gruposDoReport(final, doCertificado))]);

  return {
    referencia: String(job.reference ?? ""),
    titulo: String(job.title ?? "Work report"),
    endereco: String(job.property_address ?? ""),
    estado: !final ? "In progress" : parcial ? "Partly complete" : "Complete",
    concluidoEm: dataCurta(final?.submittedAt ?? null),
    visitas: [...new Set(datas)],
    resumo,
    detalhes: linhasDoCliente(final ?? undefined).filter((l) => l.valor !== resumo),
    naChegada: linhasDoCliente(start ?? undefined).filter((l) => l.rotulo !== "Time on site"),
    antes,
    depois,
    totalDeFotos: [...antes, ...depois].reduce((n, g) => n + g.fotos.length, 0),
  };
}
