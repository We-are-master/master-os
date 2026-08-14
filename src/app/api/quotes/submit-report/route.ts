import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPartnerReportToken } from "@/lib/quote-response-token";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  isReportTemplate,
  parseReportPhotoEntries,
  persistReportSubmission,
} from "@/lib/report-submission";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SERVICE_ROLE_KEY!,
  );
}

/**
 * POST /api/quotes/submit-report   (public, token-authenticated)
 *
 * Used by the public quote link after the quote was accepted and a job was
 * created. Accepts the START and FINAL report fields together — there is no
 * timer here, the caller provides duration manually.
 *
 * Body: multipart/form-data
 *   token         JWT-like token from createQuoteResponseToken
 *   template      "general" | "gardener" | "cleaner" | "certificate"
 *   startData     JSON-stringified field map for start_report
 *   finalData     JSON-stringified field map for final_report  (includes duration_ms)
 *   photos[<slot>][]  one or more files per slot (already downscaled client-side):
 *     - general/gardener: slots "before" and "after"
 *     - cleaner:          slots "equipment" + room keys (living_room, hallways, …) for both start & final
 *     - certificate:      final "certificate" only (PDF or image)
 *
 * The write itself lives in `lib/report-submission`, shared with the office
 * modal — both doors have to produce the same payload for Stefane to read.
 * Idempotency: if both start_report and final_report were already submitted,
 * returns 409.
 */
export async function POST(req: NextRequest) {
  // Per-IP rate limit — public endpoint.
  const ip = getClientIp(req);
  const rl = checkRateLimit(`submit-report:${ip}`, 10, 10 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart body." }, { status: 400 });
  }

  const token = String(form.get("token") ?? "").trim();
  if (!token) return NextResponse.json({ error: "Token is required." }, { status: 400 });
  const verified = verifyPartnerReportToken(token);
  if (!verified) {
    return NextResponse.json(
      { error: "Invalid or expired report link. Reports must be submitted from the partner-specific link." },
      { status: 400 },
    );
  }
  const { jobId: tokenJobId, partnerId: tokenPartnerId } = verified;

  const template = String(form.get("template") ?? "").trim();
  if (!isReportTemplate(template)) {
    return NextResponse.json({ error: "Invalid template." }, { status: 400 });
  }

  let startData: Record<string, unknown> = {};
  let finalData: Record<string, unknown> = {};
  try {
    startData = JSON.parse(String(form.get("startData") ?? "{}")) as Record<string, unknown>;
    finalData = JSON.parse(String(form.get("finalData") ?? "{}")) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid startData/finalData JSON." }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  // Resolve job from the token directly — the token is bound to job.id.
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    // Single-line literal: supabase-js infers the row type from the select
    // string, and a concatenated one degrades every column to `unknown`.
    .select("id, reference, status, partner_id, start_report_submitted, final_report_submitted, partner_timer_started_at, partner_timer_ended_at")
    .eq("id", tokenJobId)
    .is("deleted_at", null)
    .maybeSingle();
  if (jobErr || !job) {
    return NextResponse.json(
      { error: "Job not found." },
      { status: 404 },
    );
  }

  // Lock to the assigned partner: token must match the job's current
  // partner_id. If the partner was reassigned, older links stop working.
  if (!job.partner_id) {
    return NextResponse.json(
      { error: "This job has no partner assigned. Ask the office to assign a partner first." },
      { status: 409 },
    );
  }
  if (job.partner_id !== tokenPartnerId) {
    return NextResponse.json(
      { error: "This report link is for a different partner. Ask the office for an updated link." },
      { status: 403 },
    );
  }

  if (job.start_report_submitted && job.final_report_submitted) {
    return NextResponse.json(
      { error: "A report has already been submitted for this job." },
      { status: 409 },
    );
  }

  const result = await persistReportSubmission(
    supabase,
    {
      id: job.id,
      reference: job.reference,
      status: job.status,
      partner_timer_started_at: job.partner_timer_started_at,
      partner_timer_ended_at: job.partner_timer_ended_at,
    },
    {
      template,
      source: "partner_link",
      startData,
      finalData,
      photos: parseReportPhotoEntries(form),
      writeStart: true,
    },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Could not save the report." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, jobReference: job.reference });
}
