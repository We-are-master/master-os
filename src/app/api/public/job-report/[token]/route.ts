/**
 * O relatório de um job para o cliente, pelo link da fatura semanal (fatura-semanal.ts).
 * O token é o id do job assinado: abre só aquele relatório, só leitura. Devolve o PDF
 * montado (V2); sem ele, o PDF do app do parceiro (job_reports).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { jobDoTokenDoRelatorio } from "@/lib/fatura-semanal";
import { renderJobReportV2PdfBuffer } from "@/lib/pdf/render-job-report-v2";
import { jobReportPdfPathFromStoredUrl } from "@/services/job-reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const pdf = (buf: Buffer, nome: string) =>
  new NextResponse(new Uint8Array(buf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${nome.replace(/[^\w.-]+/g, "_")}"`, "cache-control": "private, max-age=300" },
  });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const jobId = jobDoTokenDoRelatorio(decodeURIComponent(token));
  if (!jobId) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  const admin = createServiceClient();

  const v2 = await renderJobReportV2PdfBuffer(admin, jobId).catch(() => null);
  if (v2) return pdf(v2.buffer, `${v2.reference}-report.pdf`);

  const { data: linhas } = await admin.from("job_reports").select("pdf_url, phase, uploaded_at").eq("job_id", jobId).order("uploaded_at", { ascending: false });
  for (const r of (linhas ?? []) as Array<{ pdf_url: string | null }>) {
    const path = r.pdf_url ? jobReportPdfPathFromStoredUrl(r.pdf_url) : null;
    if (!path) continue;
    const { data: blob } = await admin.storage.from("job-reports").download(path);
    if (blob) return pdf(Buffer.from(await blob.arrayBuffer()), "report.pdf");
  }
  return NextResponse.json({ error: "This report is not available yet" }, { status: 404 });
}
