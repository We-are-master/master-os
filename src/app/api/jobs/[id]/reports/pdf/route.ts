import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { jobReportPdfPathFromStoredUrl } from "@/services/job-reports";
import { normalizeReport, type NormalizedReport } from "@/lib/job-report-v2";
import { JobReportPDF, type SignedPhoto } from "@/lib/pdf/job-report-v2-template";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator", "viewer"]);
const REPORT_BUCKET = "job-reports";
const SIGN_TTL_SECONDS = 60 * 60;

/**
 * GET /api/jobs/[id]/reports/pdf
 *
 * Streams a PDF that combines the V2 start_report + final_report payloads
 * stored on `jobs`. Photo URLs from the private bucket are signed before
 * being passed to the @react-pdf renderer.
 *
 * Auth: requires an internal user (any role with read access).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: jobId } = await ctx.params;
  if (!isValidUUID(jobId)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { data: job, error } = await admin
    .from("jobs")
    .select(`
      id, reference, title, property_address, partner_name,
      start_report, final_report,
      start_report_approved_at, final_report_approved_at,
      clients ( name )
    `)
    .eq("id", jobId)
    .maybeSingle();

  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? "Job not found" }, { status: 404 });
  }

  const clientRow = (job as unknown as { clients?: { name?: string | null } | { name?: string | null }[] | null }).clients;
  const clientName = Array.isArray(clientRow) ? (clientRow[0]?.name ?? "") : (clientRow?.name ?? "");

  const startNorm = normalizeReport(job.start_report);
  const finalNorm = normalizeReport(job.final_report);

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

  const pdfBuffer = await renderToBuffer(
    React.createElement(JobReportPDF, {
      data: {
        reference:       String(job.reference ?? ""),
        jobTitle:        String(job.title ?? ""),
        propertyAddress: String(job.property_address ?? ""),
        clientName:      clientName || null,
        partnerName:     (job.partner_name as string | null) ?? null,
        start,
        final,
      },
    }) as Parameters<typeof renderToBuffer>[0],
  );

  const safeRef = String(job.reference ?? "report").replace(/\//g, "-");
  return new Response(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `inline; filename="${safeRef}_report.pdf"`,
      "Cache-Control":       "private, max-age=0, must-revalidate",
    },
  });
}

async function signAllPhotos(
  admin: ReturnType<typeof createServiceClient>,
  report: NormalizedReport,
): Promise<SignedPhoto[]> {
  if (report.photosFlat.length === 0) return [];
  const out: SignedPhoto[] = [];
  for (const p of report.photosFlat) {
    const path = jobReportPdfPathFromStoredUrl(p.url) ?? p.url;
    const { data } = await admin.storage.from(REPORT_BUCKET).createSignedUrl(path, SIGN_TTL_SECONDS);
    if (data?.signedUrl) {
      out.push({ url: data.signedUrl, label: p.label });
    }
  }
  return out;
}
