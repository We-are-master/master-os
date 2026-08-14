import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  isReportTemplate,
  londonWallClockToUtcIso,
  parseReportPhotoEntries,
  persistReportSubmission,
} from "@/lib/report-submission";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * POST /api/jobs/[id]/office-report   (session-authenticated)
 *
 * The office types the report for a partner who does not use the app. Same V2
 * payload as the public partner link, same columns, so the card, the PDF and
 * Stefane cannot tell the difference — only `source: "office_manual"` in the
 * envelope and the audit log say who held the keyboard.
 *
 * Body: multipart/form-data
 *   template      "general" | "gardener" | "cleaner" | "certificate"
 *   startData     JSON field map for start_report
 *   finalData     JSON field map for final_report (includes duration_ms)
 *   visitYmd      optional "YYYY-MM-DD" for the clock times below
 *   startTime     optional "HH:MM" London wall clock — on-site arrival
 *   finishTime    optional "HH:MM" London wall clock — on-site finish
 *   overwrite     "1" = edit mode: replace the submitted report
 *   photos[<slot>][]  files per slot, same slots as the public form
 *
 * Without `overwrite`, refuses when the final report is already in — a plain
 * save must never clobber a report by accident. With it, the fields are
 * replaced, photos already on the report are kept (new files append), and a
 * job that moved past final_check keeps its status.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart body." }, { status: 400 });
  }

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

  const admin = createServiceClient();
  const { data: job, error: jobErr } = await admin
    .from("jobs")
    // Single-line literal: supabase-js infers the row type from the select
    // string, and a concatenated one degrades every column to `unknown`.
    .select("id, reference, status, scheduled_date, start_report, final_report, start_report_submitted, final_report_submitted, partner_timer_started_at, partner_timer_ended_at")
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  if (jobErr || !job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const overwrite = String(form.get("overwrite") ?? "") === "1";
  if (job.final_report_submitted && !overwrite) {
    return NextResponse.json(
      { error: "This job already has a final report. Use Edit report to change it." },
      { status: 409 },
    );
  }

  // Clock times are optional: without them the window falls back to the typed
  // duration counted back from now, which is what the public link does.
  const visitYmd = String(form.get("visitYmd") ?? "").trim() || (job.scheduled_date ?? "");
  const startTime = String(form.get("startTime") ?? "").trim();
  const finishTime = String(form.get("finishTime") ?? "").trim();
  const timerStartedAt = visitYmd && startTime ? londonWallClockToUtcIso(visitYmd, startTime) : null;
  const timerEndedAt = visitYmd && finishTime ? londonWallClockToUtcIso(visitYmd, finishTime) : null;
  if (startTime && !timerStartedAt) {
    return NextResponse.json({ error: "Invalid start time." }, { status: 400 });
  }
  if (finishTime && !timerEndedAt) {
    return NextResponse.json({ error: "Invalid finish time." }, { status: 400 });
  }
  if (timerStartedAt && timerEndedAt && timerEndedAt <= timerStartedAt) {
    return NextResponse.json(
      { error: "Finish time must be after the start time." },
      { status: 400 },
    );
  }

  // A start report without a `source` in the envelope came from the partner
  // app in real time — that one is never rewritten. One typed by the office or
  // the public link carries its source and can be edited like the rest.
  const startEnvelope = (job.start_report ?? null) as { source?: unknown; photos?: unknown } | null;
  const finalEnvelope = (job.final_report ?? null) as { photos?: unknown } | null;
  const startIsFromApp = !!job.start_report_submitted && typeof startEnvelope?.source !== "string";
  const writeStart = !job.start_report_submitted || (overwrite && !startIsFromApp);

  // Editing a job that already moved past final_check must not drag it back.
  const SETTLED = new Set(["completed", "cancelled", "paid", "closed"]);
  const moveToFinalCheck = !SETTLED.has(String(job.status ?? ""));

  const result = await persistReportSubmission(
    admin,
    {
      id: job.id,
      reference: job.reference,
      status: job.status,
      partner_timer_started_at: job.partner_timer_started_at,
      partner_timer_ended_at: job.partner_timer_ended_at,
    },
    {
      template,
      source: "office_manual",
      startData,
      finalData,
      photos: parseReportPhotoEntries(form),
      writeStart,
      timerStartedAt,
      timerEndedAt,
      filledBy: auth.user.id,
      overwrite,
      existingStartPhotos: overwrite ? startEnvelope?.photos : undefined,
      existingFinalPhotos: overwrite ? finalEnvelope?.photos : undefined,
      moveToFinalCheck,
    },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Could not save the report." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    jobReference: job.reference,
    startWritten: writeStart,
    photoFailures: result.photoFailures,
  });
}
