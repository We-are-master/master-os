import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient } from "@/lib/supabase/server";
import { JobReportPDF } from "@/lib/pdf/job-report-pdf";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!id || !isValidUUID(id)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: job, error } = await supabase.from("jobs").select("*").eq("id", id).single();
  if (error || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfBuffer = await (renderToBuffer as any)(
    React.createElement(JobReportPDF, {
      job,
      startReport: job.start_report as Record<string, unknown> | null,
      finalReport: job.final_report as Record<string, unknown> | null,
    }),
  );

  return new NextResponse(pdfBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="job-report-${job.reference}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
