import { getSupabase, queryList, type ListParams, type ListResult } from "./base";
import type { Job } from "@/types/database";
import { JOB_IN_PROGRESS_STATUSES } from "@/lib/job-phases";

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
      { ...rest, statusIn: [...JOB_IN_PROGRESS_STATUSES] },
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

/** Use `null` (not `undefined`) on nullable columns you want to clear — `undefined` keys are omitted from the PATCH. */
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
