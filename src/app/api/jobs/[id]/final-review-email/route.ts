import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendFinalReviewEmail } from "@/lib/final-review-email";

type Body = { includeInvoice?: boolean; includeReport?: boolean };

/** After final review: email billing contact; body lists report PDFs and/or invoice per request. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id: jobId } = await ctx.params;
  if (!isValidUUID(jobId)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }

  let body: Body = {};
  try {
    const raw = (await req.json()) as unknown;
    if (raw && typeof raw === "object") {
      const o = raw as Record<string, unknown>;
      if (typeof o.includeInvoice === "boolean") body.includeInvoice = o.includeInvoice;
      if (typeof o.includeReport === "boolean") body.includeReport = o.includeReport;
    }
  } catch {
    body = {};
  }

  // O envio mora em `src/lib/final-review-email.ts`, o mesmo que o final check automático usa.
  const r = await sendFinalReviewEmail(createServiceClient(), jobId, {
    includeInvoice: body.includeInvoice !== false,
    includeReport: body.includeReport !== false,
    jobClient: await createClient(),
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.error, ...(r.detail ? { detail: r.detail } : {}) }, { status: r.status });
  }
  return NextResponse.json(r);
}
