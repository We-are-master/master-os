import "server-only";

import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jobReportPdfPathFromStoredUrl } from "@/services/job-reports";
import { normalizeReport, type NormalizedReport } from "@/lib/job-report-v2";
import { JobReportPDF, type SignedPhoto } from "@/lib/pdf/job-report-v2-template";
import { resolveCompanyPdfLogoDataUri } from "@/lib/pdf/resolve-logo-data-uri";
import { materialDoJobInteiro } from "@/lib/report-material-extra";

const REPORT_BUCKET = "job-reports";
const SIGN_TTL_SECONDS = 60 * 60;

/**
 * PDF do report V2 (start_report + final_report do job, com as fotos).
 *
 * Usado pela rota /api/jobs/[id]/reports/pdf (download no OS) e, desde
 * 15/10/2026, pelo e-mail final ao cliente: jobs com o report novo não têm
 * linha em `job_reports`, e o cliente recebia fotos soltas em vez do report.
 * Devolve null quando o job não tem nenhum dos dois reports.
 */
export async function renderJobReportV2PdfBuffer(
  admin: SupabaseClient,
  jobId: string,
): Promise<{ buffer: Buffer; reference: string } | null> {
  const { data: job, error } = await admin
    .from("jobs")
    .select(
      "id, reference, title, property_address, partner_name, client_name, start_report, final_report, start_report_approved_at, final_report_approved_at",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (error || !job) return null;

  const startNorm = normalizeReport(job.start_report);
  const finalNorm = normalizeReport(job.final_report);
  if (!startNorm && !finalNorm) return null;

  /**
   * Material de TODAS as visitas no relatório do cliente (19/10/2026): o que ele
   * paga de material aparece uma vez, somado, com a quebra por visita quando há
   * mais de uma. O custo que nós pagamos nunca vai para o cliente.
   */
  if (finalNorm) {
    const material = await materialDoJobInteiro(admin, jobId, job.final_report as Record<string, unknown> | null);
    delete finalNorm.fields.materials_extra_cost;
    delete finalNorm.fields.materials_receipt;
    if (material.charge > 0) {
      finalNorm.fields.materials_bought = true;
      finalNorm.fields.materials_extra_charge = material.charge;
      if (material.porVisita.length > 1) {
        finalNorm.fields.materials_by_visit = material.porVisita
          .filter((v) => v.charge > 0)
          .map((v) => `Visit ${v.index}: £${v.charge.toFixed(2)}`)
          .join(" · ");
      }
    }
  }

  const start = startNorm
    ? {
        report: startNorm,
        signedPhotos: await signAllPhotos(admin, startNorm),
        approvedAt: (job.start_report_approved_at as string | null) ?? null,
      }
    : null;
  const final = finalNorm
    ? {
        report: finalNorm,
        signedPhotos: await signAllPhotos(admin, finalNorm),
        approvedAt: (job.final_report_approved_at as string | null) ?? null,
      }
    : null;

  const clientName = String(job.client_name ?? "").trim();
  const pdf = await renderToBuffer(
    React.createElement(JobReportPDF, {
      data: {
        reference: String(job.reference ?? ""),
        jobTitle: String(job.title ?? ""),
        propertyAddress: String(job.property_address ?? ""),
        clientName: clientName || null,
        partnerName: (job.partner_name as string | null) ?? null,
        logoUrl: await resolveCompanyPdfLogoDataUri(admin),
        start,
        final,
      },
    }) as Parameters<typeof renderToBuffer>[0],
  );
  return { buffer: Buffer.from(pdf), reference: String(job.reference ?? "report") };
}

async function signAllPhotos(admin: SupabaseClient, report: NormalizedReport): Promise<SignedPhoto[]> {
  if (report.photosFlat.length === 0) return [];
  const out: SignedPhoto[] = [];
  for (const p of report.photosFlat) {
    const path = jobReportPdfPathFromStoredUrl(p.url) ?? p.url;
    const { data } = await admin.storage.from(REPORT_BUCKET).createSignedUrl(path, SIGN_TTL_SECONDS);
    if (data?.signedUrl) out.push({ url: data.signedUrl, label: p.label });
  }
  return out;
}
