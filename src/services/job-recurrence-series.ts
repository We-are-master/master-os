/**
 * Service layer for job recurrence series (mig 158).
 *
 * Two responsibilities:
 *   - createJobOrSeries: insert the series row + eager-expand the first
 *     90 days of occurrences as `jobs` rows. Idempotent via the unique
 *     partial index on (recurrence_series_id, recurrence_sequence_index).
 *   - expandSeriesToHorizon: extend `generated_through` for an existing
 *     series — used by the daily cron to keep the calendar populated.
 *   - applyEditScope: implement the "this only / this and following /
 *     entire series" semantics for edits and cancels.
 */

import { getSupabase } from "./base";
import {
  DEFAULT_EXPAND_HORIZON_DAYS,
  expandSeriesOccurrences,
  type ExpandedOccurrence,
  type SeriesPayload,
} from "@/lib/job-recurrence";
import type { Job, JobRecurrenceSeries } from "@/types/database";

export interface CreateSeriesInput {
  /** Anchor job to insert. Must include all the fields createJob expects. */
  anchorJobRow: Omit<Job, "id" | "reference" | "created_at" | "updated_at">;
  /** Series template — must include rule, start/end times, start_date, and one of (end_date, max_occurrences). */
  series: SeriesPayload & { start_time: string; end_time: string };
  /** Caller (current user) — used for created_by audit on the series, optional. */
  createdBy?: string | null;
}

export interface CreateSeriesResult {
  series: JobRecurrenceSeries;
  /** All `jobs` rows inserted, ordered by sequence_index. */
  jobs: Job[];
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
 * Compose ISO timestamps for an occurrence given its date + the series'
 * start/end time-of-day. Both are wall-clock UK times (no DST conversion);
 * Postgres stores as timestamptz with implicit UTC offset.
 */
function buildOccurrenceTimestamps(date: string, startTime: string, endTime: string): {
  scheduled_start_at: string;
  scheduled_end_at: string;
  expected_finish_at: string;
} {
  // start_time and end_time arrive as 'HH:MM:SS'.
  return {
    scheduled_start_at: `${date}T${startTime}`,
    scheduled_end_at: `${date}T${endTime}`,
    expected_finish_at: `${date}T${endTime}`,
  };
}

/**
 * Build a job row for a single occurrence by overlaying schedule fields on
 * top of the anchor row template.
 */
function occurrenceJobRow(
  anchorTemplate: Omit<Job, "id" | "reference" | "created_at" | "updated_at">,
  series: SeriesPayload & { start_time: string; end_time: string },
  occ: ExpandedOccurrence,
  seriesId: string,
): Omit<Job, "id" | "reference" | "created_at" | "updated_at"> {
  const ts = buildOccurrenceTimestamps(occ.date, series.start_time, series.end_time);
  return {
    ...anchorTemplate,
    job_kind: "recurring",
    scheduled_date: occ.date,
    scheduled_start_at: ts.scheduled_start_at,
    scheduled_end_at: ts.scheduled_end_at,
    scheduled_finish_date: occ.date,
    expected_finish_at: ts.expected_finish_at,
    recurrence_series_id: seriesId,
    recurrence_sequence_index: occ.sequence_index,
    recurrence_detached_at: null,
  };
}

/**
 * Insert a recurrence series + eager-expand its first occurrences (up to
 * `horizonDays` days from start_date). The first occurrence becomes the
 * anchor job. Subsequent ones inherit the same template.
 *
 * Idempotency: the unique partial index `jobs_recurrence_seq_uq` prevents
 * double-inserting an occurrence even under retries; we INSERT each row
 * with `.insert(...).select().single()` and tolerate `23505` (unique
 * violation) silently.
 */
export async function createJobOrSeries(
  input: CreateSeriesInput,
  opts: { horizonDays?: number } = {},
): Promise<CreateSeriesResult> {
  const supabase = getSupabase();
  const horizonDays = opts.horizonDays ?? DEFAULT_EXPAND_HORIZON_DAYS;

  // 1) Insert the series row first, with generated_through = start_date - 1
  //    so the expansion loop below treats start_date as the first occurrence.
  const seriesInsertPayload = {
    rule: input.series.rule,
    start_time: input.series.start_time,
    end_time: input.series.end_time,
    start_date: input.series.start_date,
    end_date: input.series.end_date ?? null,
    max_occurrences: input.series.max_occurrences ?? null,
    generated_through: null,
    status: "active",
  };

  const { data: seriesRow, error: seriesErr } = await supabase
    .from("job_recurrence_series")
    .insert(seriesInsertPayload)
    .select()
    .single();
  if (seriesErr) throw seriesErr;
  if (!seriesRow) throw new Error("createJobOrSeries: series insert returned no row");
  const series = seriesRow as JobRecurrenceSeries;

  // 2) Compute occurrences within horizon.
  const horizonYmd = plusDays(input.series.start_date, horizonDays);
  const upperBoundYmd = input.series.end_date && input.series.end_date < horizonYmd
    ? input.series.end_date
    : horizonYmd;

  const occurrences = expandSeriesOccurrences(input.series, {
    fromDate: input.series.start_date,
    toDate: upperBoundYmd,
  });
  if (occurrences.length === 0) {
    throw new Error("createJobOrSeries: series rule yielded zero occurrences in horizon — check rule + dates.");
  }

  // 3) Insert each occurrence as a job row. The first one is the "anchor".
  const inserted: Job[] = [];
  let lastInsertedDate: string | null = null;
  for (const occ of occurrences) {
    const row = occurrenceJobRow(input.anchorJobRow, input.series, occ, series.id);
    const { data: jobRow, error: jobErr } = await supabase
      .from("jobs")
      .insert({ ...row, reference: undefined })  // reference filled by trigger
      .select()
      .single();
    if (jobErr) {
      // 23505 = unique_violation (idempotent: another caller already inserted)
      const code = (jobErr as { code?: string }).code;
      if (code === "23505") continue;
      throw jobErr;
    }
    if (jobRow) {
      inserted.push(jobRow as Job);
      lastInsertedDate = occ.date;
    }
  }

  // 4) Set anchor + generated_through on the series.
  const firstAnchor = inserted[0];
  const updatePatch: Record<string, unknown> = {
    generated_through: lastInsertedDate,
  };
  if (firstAnchor && !series.anchor_job_id) {
    updatePatch.anchor_job_id = firstAnchor.id;
  }
  const { data: updatedSeries, error: updErr } = await supabase
    .from("job_recurrence_series")
    .update(updatePatch)
    .eq("id", series.id)
    .select()
    .single();
  if (updErr) throw updErr;

  return {
    series: (updatedSeries as JobRecurrenceSeries) ?? series,
    jobs: inserted,
  };
}

/**
 * Extend a series' generated_through forward to `targetDate` by inserting
 * any missing occurrences. Called by the cron and on-demand when the
 * calendar requests a future month past the current horizon.
 *
 * Returns the count of newly-inserted occurrences.
 */
export async function expandSeriesToHorizon(
  seriesId: string,
  targetDate: string,
): Promise<number> {
  const supabase = getSupabase();

  // Fetch series + its current anchor to use as a row template.
  const { data: seriesRow, error: seriesErr } = await supabase
    .from("job_recurrence_series")
    .select("*")
    .eq("id", seriesId)
    .is("deleted_at", null)
    .maybeSingle();
  if (seriesErr) throw seriesErr;
  if (!seriesRow) throw new Error(`Series ${seriesId} not found`);
  const series = seriesRow as JobRecurrenceSeries;
  if (series.status !== "active") return 0;

  // Skip if already past target.
  if (series.generated_through && series.generated_through >= targetDate) return 0;

  // Find the anchor job (or any extant occurrence) to use as a template.
  const { data: anchorRow, error: anchorErr } = await supabase
    .from("jobs")
    .select("*")
    .eq("recurrence_series_id", seriesId)
    .is("deleted_at", null)
    .order("recurrence_sequence_index", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (anchorErr) throw anchorErr;
  if (!anchorRow) return 0; // series exists but no occurrences yet — let createJobOrSeries handle it
  const anchor = anchorRow as Job;

  // Compute occurrences strictly after generated_through.
  const fromDate = series.generated_through
    ? plusDays(series.generated_through, 1)
    : series.start_date;

  const upperBoundYmd = series.end_date && series.end_date < targetDate
    ? series.end_date
    : targetDate;

  const occurrences = expandSeriesOccurrences(
    {
      rule: series.rule,
      start_date: series.start_date,
      end_date: series.end_date,
      max_occurrences: series.max_occurrences,
    },
    {
      fromDate,
      toDate: upperBoundYmd,
      // Skip already-materialised sequences.
      skipUpToSequence: anchor.recurrence_sequence_index ?? 0,
    },
  );

  let insertedCount = 0;
  for (const occ of occurrences) {
    const row = occurrenceJobRow(
      // Strip per-instance fields off the anchor template.
      stripPerInstanceFields(anchor),
      {
        rule: series.rule,
        start_time: series.start_time,
        end_time: series.end_time,
        start_date: series.start_date,
        end_date: series.end_date,
        max_occurrences: series.max_occurrences,
      },
      occ,
      series.id,
    );
    const { error: jobErr } = await supabase
      .from("jobs")
      .insert({ ...row, reference: undefined });
    if (jobErr) {
      const code = (jobErr as { code?: string }).code;
      if (code === "23505") continue;
      throw jobErr;
    }
    insertedCount += 1;
  }

  // Bump generated_through.
  const lastDate = occurrences.length > 0 ? occurrences[occurrences.length - 1]!.date : upperBoundYmd;
  await supabase
    .from("job_recurrence_series")
    .update({ generated_through: lastDate })
    .eq("id", seriesId);

  return insertedCount;
}

/**
 * Fields on the anchor that should NOT carry over to subsequent
 * occurrences (timer state, completion flags, audit timestamps, etc.).
 */
function stripPerInstanceFields(
  job: Job,
): Omit<Job, "id" | "reference" | "created_at" | "updated_at"> {
  const stripped: Partial<Job> = { ...job };
  delete stripped.id;
  delete stripped.reference;
  delete stripped.created_at;
  delete stripped.updated_at;
  // Per-instance state must be reset.
  delete stripped.completed_date;
  delete stripped.report_submitted_at;
  delete stripped.partner_timer_started_at;
  delete stripped.partner_timer_ended_at;
  delete stripped.partner_timer_accum_paused_ms;
  delete stripped.partner_timer_is_paused;
  delete stripped.partner_timer_pause_began_at;
  delete stripped.timer_elapsed_seconds;
  delete stripped.timer_last_started_at;
  delete stripped.timer_is_running;
  delete stripped.review_sent_at;
  delete stripped.review_send_method;
  delete stripped.start_report;
  delete stripped.start_report_submitted;
  delete stripped.start_report_skipped;
  delete stripped.final_report;
  delete stripped.final_report_submitted;
  delete stripped.final_report_skipped;
  delete stripped.partner_cancelled_at;
  delete stripped.partner_cancellation_fee;
  delete stripped.partner_cancellation_reason;
  delete stripped.cancellation_reason;
  delete stripped.cancelled_at;
  delete stripped.cancelled_by;
  delete stripped.customer_review_rating;
  delete stripped.customer_review_comment;
  delete stripped.customer_review_submitted_at;
  delete stripped.deleted_at;
  delete stripped.deleted_previous_status;
  delete stripped.on_hold_previous_status;
  delete stripped.on_hold_at;
  delete stripped.on_hold_reason;
  delete stripped.on_hold_snapshot_scheduled_date;
  delete stripped.on_hold_snapshot_scheduled_start_at;
  delete stripped.on_hold_snapshot_scheduled_end_at;
  delete stripped.on_hold_snapshot_scheduled_finish_date;
  // Reset financial state to defaults.
  stripped.cash_in = 0;
  stripped.cash_out = 0;
  stripped.expenses = 0;
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
  return stripped as Omit<Job, "id" | "reference" | "created_at" | "updated_at">;
}

/** Helper used by edit-scope dialog: list non-detached occurrences ≥ given index. */
export async function listSeriesFutureOccurrences(
  seriesId: string,
  fromSequenceInclusive: number,
): Promise<Job[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("recurrence_series_id", seriesId)
    .is("deleted_at", null)
    .is("recurrence_detached_at", null)
    .gte("recurrence_sequence_index", fromSequenceInclusive)
    .order("recurrence_sequence_index", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Job[];
}

/** Mark a single occurrence as detached from its series. */
export async function detachOccurrence(jobId: string): Promise<Job> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .update({ recurrence_detached_at: new Date().toISOString() })
    .eq("id", jobId)
    .select()
    .single();
  if (error) throw error;
  return data as Job;
}

/**
 * Patch shape that survives propagation across occurrences. Only fields that
 * make sense series-wide are propagated when scope = 'this_and_following' or
 * 'entire_series'. Date-only fields (scheduled_date, scheduled_finish_date)
 * are NEVER propagated — each occurrence keeps its own date.
 */
const PROPAGATABLE_FIELDS: ReadonlyArray<keyof Job> = [
  "partner_id",
  "partner_name",
  "scope",
  "internal_notes",
  "additional_notes",
  "client_price",
  "partner_cost",
  "materials_cost",
  "margin_percent",
  "in_ccz",
  "has_free_parking",
];

/**
 * Apply an edit to a recurring occurrence with the chosen scope.
 *
 *   • this_only          → detach + apply patch to this row.
 *   • this_and_following → apply patch to this row AND every non-detached
 *                          occurrence with sequence_index >= this. Date-only
 *                          fields (scheduled_date, scheduled_finish_date) are
 *                          NOT propagated — they remain per-occurrence.
 *   • entire_series      → apply patch to every non-detached occurrence in
 *                          the series (past + future), again excluding
 *                          date-only fields.
 *
 * Returns the count of rows updated.
 */
export async function applyEditScope(
  jobId: string,
  patch: Partial<Job>,
  scope: "this_only" | "this_and_following" | "entire_series",
): Promise<{ updated: number; detached: boolean }> {
  const supabase = getSupabase();

  // Always update the target row first.
  const { data: targetRow, error: tErr } = await supabase
    .from("jobs")
    .select("id, recurrence_series_id, recurrence_sequence_index")
    .eq("id", jobId)
    .maybeSingle();
  if (tErr) throw tErr;
  if (!targetRow) throw new Error("Job not found");

  const seriesId = (targetRow as { recurrence_series_id: string | null }).recurrence_series_id;
  const seqIndex = (targetRow as { recurrence_sequence_index: number | null }).recurrence_sequence_index ?? 0;

  if (!seriesId || scope === "this_only") {
    const detachPatch = scope === "this_only"
      ? { ...patch, recurrence_detached_at: new Date().toISOString() }
      : patch;
    const { error: updErr } = await supabase
      .from("jobs")
      .update(detachPatch)
      .eq("id", jobId);
    if (updErr) throw updErr;
    return { updated: 1, detached: scope === "this_only" };
  }

  // Strip date-only fields from the patch when propagating across occurrences.
  const propagatable: Partial<Job> = {};
  for (const k of PROPAGATABLE_FIELDS) {
    if (k in patch) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (propagatable as any)[k] = (patch as any)[k];
    }
  }
  // Apply the FULL patch (including date) to the originating row…
  const { error: selfErr } = await supabase.from("jobs").update(patch).eq("id", jobId);
  if (selfErr) throw selfErr;

  // …then the propagatable subset to siblings.
  let q = supabase
    .from("jobs")
    .update(propagatable)
    .eq("recurrence_series_id", seriesId)
    .is("recurrence_detached_at", null)
    .neq("id", jobId);

  if (scope === "this_and_following") {
    q = q.gte("recurrence_sequence_index", seqIndex);
  }

  const { data: bulkRows, error: bulkErr } = await q.select("id");
  if (bulkErr) throw bulkErr;
  return { updated: 1 + (bulkRows?.length ?? 0), detached: false };
}

/** Cancel a series — soft-delete the series + soft-delete future non-detached occurrences. */
export async function cancelSeries(
  seriesId: string,
  cutoffDate: string,
  reason: string | null = null,
): Promise<{ seriesUpdated: JobRecurrenceSeries; affectedJobs: number }> {
  const supabase = getSupabase();

  // 1) Update series status + end_date.
  const { data: seriesRow, error: seriesErr } = await supabase
    .from("job_recurrence_series")
    .update({ status: "cancelled", end_date: cutoffDate })
    .eq("id", seriesId)
    .select()
    .single();
  if (seriesErr) throw seriesErr;

  // 2) Soft-delete future non-detached non-completed jobs.
  const { data: affected, error: affErr } = await supabase
    .from("jobs")
    .update({
      deleted_at: new Date().toISOString(),
      cancellation_reason: reason ?? "series cancelled",
      status: "cancelled",
    })
    .eq("recurrence_series_id", seriesId)
    .is("recurrence_detached_at", null)
    .is("deleted_at", null)
    .gte("scheduled_date", cutoffDate)
    .neq("status", "completed")
    .select("id");
  if (affErr) throw affErr;

  return {
    seriesUpdated: seriesRow as JobRecurrenceSeries,
    affectedJobs: (affected ?? []).length,
  };
}
