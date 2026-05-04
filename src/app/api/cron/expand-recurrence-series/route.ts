import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import {
  expandSeriesOccurrences,
  DEFAULT_EXPAND_HORIZON_DAYS,
} from "@/lib/job-recurrence";
import type { Job, JobRecurrenceSeries } from "@/types/database";

/**
 * Constant-time secret comparison — same pattern as daily-brief.
 */
function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const SAFE_HOUR = 12;

function ymdToLocalDate(ymd: string): Date {
  return new Date(`${ymd}T${String(SAFE_HOUR).padStart(2, "0")}:00:00`);
}

function dateToYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function plusDays(ymd: string, n: number): string {
  const d = ymdToLocalDate(ymd);
  d.setDate(d.getDate() + n);
  return dateToYmd(d);
}

/**
 * Strip per-instance fields from a job template before insert.
 * Mirrored from job-recurrence-series.ts but inlined here so the cron
 * route doesn't pull the full service module.
 */
function stripPerInstanceFields(job: Job): Partial<Job> {
  const stripped: Partial<Job> = { ...job };
  delete stripped.id;
  delete stripped.reference;
  delete stripped.created_at;
  delete stripped.updated_at;
  delete stripped.completed_date;
  delete stripped.report_submitted_at;
  delete stripped.partner_timer_started_at;
  delete stripped.partner_timer_ended_at;
  delete stripped.timer_elapsed_seconds;
  delete stripped.timer_last_started_at;
  delete stripped.timer_is_running;
  delete stripped.start_report;
  delete stripped.start_report_submitted;
  delete stripped.final_report;
  delete stripped.final_report_submitted;
  delete stripped.deleted_at;
  delete stripped.on_hold_at;
  delete stripped.on_hold_reason;
  delete stripped.on_hold_snapshot_scheduled_date;
  delete stripped.on_hold_snapshot_scheduled_start_at;
  delete stripped.on_hold_snapshot_scheduled_end_at;
  delete stripped.on_hold_snapshot_scheduled_finish_date;
  stripped.cash_in = 0;
  stripped.cash_out = 0;
  stripped.commission = 0;
  stripped.report_submitted = false;
  stripped.report_1_uploaded = false;
  stripped.report_1_approved = false;
  stripped.report_2_uploaded = false;
  stripped.report_2_approved = false;
  stripped.report_3_uploaded = false;
  stripped.report_3_approved = false;
  stripped.partner_payment_1_paid = false;
  stripped.partner_payment_2_paid = false;
  stripped.partner_payment_3_paid = false;
  stripped.customer_deposit_paid = false;
  stripped.customer_final_paid = false;
  stripped.status = job.partner_id ? "scheduled" : "unassigned";
  stripped.progress = 0;
  stripped.current_phase = 0;
  return stripped;
}

/**
 * Daily cron: extend the horizon for every active recurrence series whose
 * `generated_through` is closer than `DEFAULT_EXPAND_HORIZON_DAYS` (90)
 * away from today. Inserts the missing occurrences as `jobs` rows.
 *
 * Vercel cron config in `vercel.json`:
 *   { "path": "/api/cron/expand-recurrence-series", "schedule": "0 4 * * *" }
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const expected = process.env.CRON_SECRET?.trim();
  if (!secretsMatch(bearer, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceClient();
  const today = dateToYmd(new Date());
  const horizonTarget = plusDays(today, DEFAULT_EXPAND_HORIZON_DAYS);

  const { data: seriesRows, error: listErr } = await admin
    .from("job_recurrence_series")
    .select("*")
    .eq("status", "active")
    .is("deleted_at", null);

  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  const series = (seriesRows ?? []) as JobRecurrenceSeries[];
  const stats: { seriesId: string; inserted: number; skipped?: string }[] = [];

  for (const s of series) {
    // Skip if already past horizon.
    if (s.generated_through && s.generated_through >= horizonTarget) {
      stats.push({ seriesId: s.id, inserted: 0, skipped: "past_horizon" });
      continue;
    }
    // Skip if past end_date.
    if (s.end_date && s.end_date < today) {
      stats.push({ seriesId: s.id, inserted: 0, skipped: "past_end_date" });
      continue;
    }

    // Find an anchor row to use as template.
    const { data: anchorRow, error: anchorErr } = await admin
      .from("jobs")
      .select("*")
      .eq("recurrence_series_id", s.id)
      .is("deleted_at", null)
      .order("recurrence_sequence_index", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (anchorErr || !anchorRow) {
      stats.push({ seriesId: s.id, inserted: 0, skipped: "no_anchor" });
      continue;
    }
    const anchor = anchorRow as Job;

    const fromDate = s.generated_through
      ? plusDays(s.generated_through, 1)
      : s.start_date;

    const upperBoundYmd = s.end_date && s.end_date < horizonTarget
      ? s.end_date
      : horizonTarget;

    let occurrences;
    try {
      occurrences = expandSeriesOccurrences(
        {
          rule: s.rule,
          start_date: s.start_date,
          end_date: s.end_date,
          max_occurrences: s.max_occurrences,
        },
        {
          fromDate,
          toDate: upperBoundYmd,
          skipUpToSequence: anchor.recurrence_sequence_index ?? 0,
        },
      );
    } catch (e) {
      stats.push({ seriesId: s.id, inserted: 0, skipped: `expand_error:${(e as Error).message}` });
      continue;
    }

    let insertedCount = 0;
    let lastDate: string | null = s.generated_through ?? null;
    for (const occ of occurrences) {
      const template = stripPerInstanceFields(anchor);
      const row = {
        ...template,
        job_kind: "recurring",
        scheduled_date: occ.date,
        scheduled_start_at: `${occ.date}T${s.start_time}`,
        scheduled_end_at: `${occ.date}T${s.end_time}`,
        scheduled_finish_date: occ.date,
        expected_finish_at: `${occ.date}T${s.end_time}`,
        recurrence_series_id: s.id,
        recurrence_sequence_index: occ.sequence_index,
        recurrence_detached_at: null,
        reference: undefined,
      };
      const { error: jobErr } = await admin.from("jobs").insert(row);
      if (jobErr) {
        const code = (jobErr as { code?: string }).code;
        if (code === "23505") continue; // unique violation — already inserted
        // Other errors: keep going so a single bad series doesn't kill the cron.
        stats.push({ seriesId: s.id, inserted: insertedCount, skipped: `insert_error:${jobErr.message}` });
        break;
      }
      insertedCount += 1;
      lastDate = occ.date;
    }

    if (lastDate && lastDate !== s.generated_through) {
      await admin
        .from("job_recurrence_series")
        .update({ generated_through: lastDate })
        .eq("id", s.id);
    }
    if (!stats.find((x) => x.seriesId === s.id)) {
      stats.push({ seriesId: s.id, inserted: insertedCount });
    }
  }

  return NextResponse.json({
    ok: true,
    series_count: series.length,
    stats,
    today,
    horizon_target: horizonTarget,
  });
}
