import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { renderJobReportV2PdfBuffer } from "@/lib/pdf/render-job-report-v2";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator", "viewer"]);

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

  const pdf = await renderJobReportV2PdfBuffer(createServiceClient(), jobId);
  if (!pdf) {
    return NextResponse.json({ error: "Job not found or no report yet" }, { status: 404 });
  }
  const safeRef = pdf.reference.replace(/\//g, "-");
  return new Response(new Uint8Array(pdf.buffer), {
    status: 200,
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `inline; filename="${safeRef}_report.pdf"`,
      "Cache-Control":       "private, max-age=0, must-revalidate",
    },
  });
}
