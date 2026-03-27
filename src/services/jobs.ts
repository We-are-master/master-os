import { getSupabase, queryList, type ListParams, type ListResult } from "./base";
import type { Job } from "@/types/database";
import { JOB_IN_PROGRESS_STATUSES, JOB_WORK_PHASE_STATUSES } from "@/lib/job-phases";
import { jobBillableRevenue, jobProfit } from "@/lib/job-financials";

/** Draft through final check — booked revenue before collection (matches Jobs KPI). */
const REVENUE_BOOKED_STATUSES: Job["status"][] = [
  "draft",
  "scheduled",
  "late",
  ...JOB_IN_PROGRESS_STATUSES,
];

/** Sum of job amount (client_price + extras) for pipeline jobs; not limited to the current list page. */
export async function getTotalRevenueBookedPipeline(dateRange?: { from?: string; to?: string }): Promise<number> {
  const supabase = getSupabase();
  let query = supabase
    .from("jobs")
    .select("client_price, extras_amount")
    .in("status", REVENUE_BOOKED_STATUSES)
    .is("deleted_at", null);
  if (dateRange?.from) query = query.gte("scheduled_date", dateRange.from);
  if (dateRange?.to) query = query.lte("scheduled_date", dateRange.to);
  const { data, error } = await query;
  if (error || !data) return 0;
  return data.reduce((sum, row) => sum + jobBillableRevenue(row as Pick<Job, "client_price" | "extras_amount">), 0);
}

/** Revenue-weighted average margin % for pipeline jobs (same scope as total revenue booked). */
export async function getAverageMarginPercentPipeline(dateRange?: { from?: string; to?: string }): Promise<number> {
  const supabase = getSupabase();
  let query = supabase
    .from("jobs")
    .select("client_price, extras_amount, partner_cost, materials_cost")
    .in("status", REVENUE_BOOKED_STATUSES)
    .is("deleted_at", null);
  if (dateRange?.from) query = query.gte("scheduled_date", dateRange.from);
  if (dateRange?.to) query = query.lte("scheduled_date", dateRange.to);
  const { data, error } = await query;
  if (error || !data?.length) return 0;
  let rev = 0;
  let profit = 0;
  for (const row of data) {
    const j = row as Pick<Job, "client_price" | "extras_amount" | "partner_cost" | "materials_cost">;
    const r = jobBillableRevenue(j);
    if (r <= 0) continue;
    rev += r;
    profit += jobProfit(j);
  }
  return rev > 0 ? Math.round((profit / rev) * 1000) / 10 : 0;
}

export async function getAverageTicketPipeline(dateRange?: { from?: string; to?: string }): Promise<number> {
  const supabase = getSupabase();
  let query = supabase
    .from("jobs")
    .select("client_price, extras_amount")
    .in("status", REVENUE_BOOKED_STATUSES)
    .is("deleted_at", null);
  if (dateRange?.from) query = query.gte("scheduled_date", dateRange.from);
  if (dateRange?.to) query = query.lte("scheduled_date", dateRange.to);
  const { data, error } = await query;
  if (error || !data?.length) return 0;
  const revenues = data
    .map((row) => jobBillableRevenue(row as Pick<Job, "client_price" | "extras_amount">))
    .filter((v) => v > 0);
  if (revenues.length === 0) return 0;
  const total = revenues.reduce((sum, v) => sum + v, 0);
  return total / revenues.length;
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
    supabase.from("jobs").update({ status: "late" }).eq("status", "scheduled").lt("scheduled_start_at", nowIso),
    supabase.from("jobs").update({ status: "late" }).eq("status", "scheduled").is("scheduled_start_at", null).lt("scheduled_date", today),
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
      { ...rest, statusIn: [...JOB_WORK_PHASE_STATUSES], dateColumn: "scheduled_date" },
      {
        searchColumns: ["reference", "title", "client_name", "partner_name", "property_address"],
        defaultSort: "created_at",
      }
    );
  }
  return queryList<Job>("jobs", { ...params, dateColumn: "scheduled_date" }, {
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
  const { data, error } = await supabase
    .from("jobs")
    .insert({ ...input, reference: ref })
    .select()
    .single();
  if (error) throw error;
  return data as Job;
}

export async function updateJob(
  id: string,
  input: Partial<Job>
): Promise<Job> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Job;
}
