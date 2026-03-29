import { getSupabase, queryList, applyJobsScheduleRangeToQuery, type ListParams, type ListResult } from "./base";
import type { Job } from "@/types/database";
import { JOB_ONSITE_PROGRESS_STATUSES } from "@/lib/job-phases";
import {
  applyJobDbCompat,
  isLegacyJobSchema,
  prepareJobRowForInsert,
  prepareJobRowForUpdate,
} from "@/lib/job-schema-compat";
import { isPostgrestWriteRetryableError } from "@/lib/postgrest-errors";

/** Slim rows for Jobs Management KPIs (avg ticket, avg margin); loaded in chunks to avoid pagination bias. */
export type JobFinancialKpiRow = Pick<
  Job,
  "status" | "client_price" | "extras_amount" | "partner_cost" | "materials_cost"
>;

export async function fetchAllJobsFinancialKpiRows(
  scheduleRange?: { from: string; to: string } | null
): Promise<JobFinancialKpiRow[]> {
  const supabase = getSupabase();
  const chunk = 1000;
  let columns = "status,client_price,extras_amount,partner_cost,materials_cost";
  const all: JobFinancialKpiRow[] = [];
  for (let from = 0; ; from += chunk) {
    const run = async (cols: string) => {
      let q = supabase.from("jobs").select(cols).is("deleted_at", null);
      if (scheduleRange) q = applyJobsScheduleRangeToQuery(q, scheduleRange);
      return q.order("created_at", { ascending: false }).range(from, from + chunk - 1);
    };
    let { data, error } = await run(columns);
    if (error && isPostgrestWriteRetryableError(error) && columns.includes("extras_amount")) {
      columns = "status,client_price,partner_cost,materials_cost";
      ({ data, error } = await run(columns));
    }
    if (error) throw error;
    const batch = (data ?? []) as unknown as JobFinancialKpiRow[];
    all.push(...batch);
    if (batch.length < chunk) break;
  }
  return all;
}

// Throttle: mark-late runs at most once every 5 minutes per server instance
// to avoid write contention on every paginated list request.
let lastMarkLateAt = 0;
const MARK_LATE_INTERVAL_MS = 5 * 60 * 1000;

export async function markLateJobs(): Promise<void> {
  const supabase = getSupabase();
  const nowIso = new Date().toISOString();
  const today = new Date().toISOString().slice(0, 10);
  await Promise.all([
    // Arrival window set: late only after the window ends (e.g. after 10:00 for 09:00–10:00).
    supabase
      .from("jobs")
      .update({ status: "late" })
      .eq("status", "scheduled")
      .not("scheduled_end_at", "is", null)
      .lt("scheduled_end_at", nowIso),
    // Start time only (no end): late after scheduled start (legacy behaviour).
    supabase
      .from("jobs")
      .update({ status: "late" })
      .eq("status", "scheduled")
      .is("scheduled_end_at", null)
      .not("scheduled_start_at", "is", null)
      .lt("scheduled_start_at", nowIso),
    // Date-only jobs: late when the calendar day is in the past.
    supabase
      .from("jobs")
      .update({ status: "late" })
      .eq("status", "scheduled")
      .is("scheduled_start_at", null)
      .lt("scheduled_date", today),
  ]);
  lastMarkLateAt = Date.now();
}

export async function listJobs(params: ListParams): Promise<ListResult<Job>> {
  if (Date.now() - lastMarkLateAt > MARK_LATE_INTERVAL_MS) {
    void markLateJobs(); // fire-and-forget: don't block the list query
  }

  if (params.status === "in_progress") {
    const { status: _omit, ...rest } = params;
    return queryList<Job>(
      "jobs",
      { ...rest, statusIn: [...JOB_ONSITE_PROGRESS_STATUSES] },
      {
        searchColumns: ["reference", "title", "client_name", "partner_name", "property_address"],
        defaultSort: "created_at",
      }
    );
  }
  if (params.status === "scheduled") {
    const { status: _omit, ...rest } = params;
    return queryList<Job>(
      "jobs",
      { ...rest, statusIn: ["scheduled", "late"] },
      {
        searchColumns: ["reference", "title", "client_name", "partner_name", "property_address"],
        defaultSort: "created_at",
      }
    );
  }
  return queryList<Job>("jobs", params, {
    searchColumns: ["reference", "title", "client_name", "partner_name", "property_address"],
    defaultSort: "created_at",
  });
}

export async function getJob(id: string): Promise<Job | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data as Job;
}

export async function getJobByQuoteId(quoteId: string): Promise<Job | null> {
  if (isLegacyJobSchema()) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("quote_id", quoteId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data as Job | null;
}

export async function createJob(
  input: Omit<Job, "id" | "reference" | "created_at" | "updated_at">
): Promise<Job> {
  const supabase = getSupabase();
  const { data: ref } = await supabase.rpc("next_job_ref");
  const baseRow = { ...input, reference: ref } as Record<string, unknown>;
  const row = prepareJobRowForInsert(baseRow);
  let { data, error } = await supabase.from("jobs").insert(row).select().single();
  if (error && isPostgrestWriteRetryableError(error)) {
    const retry = await supabase.from("jobs").insert(applyJobDbCompat(baseRow)).select().single();
    data = retry.data;
    error = retry.error;
  }
  if (error) throw error;
  return data as Job;
}

/** Use `null` (not `undefined`) on nullable columns you want to clear — `undefined` keys are omitted from the PATCH. */
export async function updateJob(
  id: string,
  input: Partial<Job>
): Promise<Job> {
  const supabase = getSupabase();
  const basePatch = input as Record<string, unknown>;
  const patch = prepareJobRowForUpdate(basePatch);
  let { data, error } = await supabase.from("jobs").update(patch).eq("id", id).select().single();
  if (error && isPostgrestWriteRetryableError(error)) {
    const retry = await supabase
      .from("jobs")
      .update(applyJobDbCompat({ ...basePatch }))
      .eq("id", id)
      .select()
      .single();
    data = retry.data;
    error = retry.error;
  }
  if (error) throw error;
  return data as Job;
}
