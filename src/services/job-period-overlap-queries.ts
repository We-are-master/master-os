import { createClient } from "@/lib/supabase/client";
import {
  jobExecutionOverlapsYmdRange,
  jobScheduleStartInYmdRange,
  type JobPeriodOverlapRow,
} from "@/lib/job-period-overlap";
import type { Job } from "@/types/database";

const CHUNK = 800;

/** Full rows for Jobs Management when the schedule window filters by **start day** in range. */
export async function loadAllJobsForPeriodOverlap(statusIn: string[], range: { from: string; to: string }): Promise<Job[]> {
  const supabase = createClient();
  const { from, to } = range;
  const activeStatuses = statusIn.filter((s) => s !== "deleted");
  const includeDeletedArchived = statusIn.includes("deleted");
  const out: Job[] = [];

  const pushChunk = (batch: Job[]) => {
    for (const j of batch) {
      if (jobScheduleStartInYmdRange(j, from, to)) out.push(j);
    }
  };

  if (activeStatuses.length > 0) {
    for (let offset = 0; ; offset += CHUNK) {
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .is("deleted_at", null)
        .in("status", activeStatuses)
        .order("created_at", { ascending: false })
        .range(offset, offset + CHUNK - 1);
      if (error) throw error;
      const batch = (data ?? []) as Job[];
      pushChunk(batch);
      if (batch.length < CHUNK) break;
    }
  }

  if (includeDeletedArchived) {
    for (let offset = 0; ; offset += CHUNK) {
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .eq("status", "deleted")
        .not("deleted_at", "is", null)
        .order("created_at", { ascending: false })
        .range(offset, offset + CHUNK - 1);
      if (error) throw error;
      const batch = (data ?? []) as Job[];
      pushChunk(batch);
      if (batch.length < CHUNK) break;
    }
  }

  return out;
}

/** Archived (`status = deleted`) jobs whose schedule start overlaps the window — for Closed tab counts. */
export async function getArchivedDeletedJobsOverlappingScheduleCount(range: {
  from: string;
  to: string;
}): Promise<number> {
  const supabase = createClient();
  let n = 0;
  for (let offset = 0; ; offset += CHUNK) {
    const { data, error } = await supabase
      .from("jobs")
      .select("id,status,created_at,scheduled_date,scheduled_finish_date,scheduled_start_at,scheduled_end_at,completed_date")
      .eq("status", "deleted")
      .not("deleted_at", "is", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + CHUNK - 1);
    if (error) throw error;
    const batch = (data ?? []) as JobPeriodOverlapRow[];
    for (const row of batch) {
      if (jobScheduleStartInYmdRange(row, range.from, range.to)) n += 1;
    }
    if (batch.length < CHUNK) break;
  }
  return n;
}

/** Tab counts when a schedule window is active — same **start-day** semantics as the job list. */
export async function getJobStatusCountsWithScheduleOverlap(
  statuses: string[],
  range: { from: string; to: string },
): Promise<Record<string, number>> {
  const supabase = createClient();
  const counts: Record<string, number> = Object.fromEntries(statuses.map((s) => [s, 0]));
  counts["all"] = 0;

  for (let offset = 0; ; offset += CHUNK) {
    const { data, error } = await supabase
      .from("jobs")
      .select("id,status,created_at,scheduled_date,scheduled_finish_date,scheduled_start_at,scheduled_end_at,completed_date")
      .is("deleted_at", null)
      .in("status", statuses)
      .order("created_at", { ascending: false })
      .range(offset, offset + CHUNK - 1);
    if (error) throw error;
    const batch = (data ?? []) as JobPeriodOverlapRow[];
    for (const row of batch) {
      if (!jobScheduleStartInYmdRange(row, range.from, range.to)) continue;
      const s = row.status;
      if (typeof counts[s] === "number") counts[s] += 1;
      counts["all"] += 1;
    }
    if (batch.length < CHUNK) break;
  }
  return counts;
}

/**
 * Tab counts with no schedule filter — chunked `select` of `status` only, same RLS as the job list.
 * Prefer this over `count: exact` + `head: true` per status, which often returns 0 on some PostgREST stacks.
 */
export async function getJobStatusCountsByChunkedSelect(statuses: string[]): Promise<Record<string, number>> {
  const supabase = createClient();
  const counts: Record<string, number> = Object.fromEntries(statuses.map((s) => [s, 0]));

  for (let offset = 0; ; offset += CHUNK) {
    const { data, error } = await supabase
      .from("jobs")
      .select("status")
      .is("deleted_at", null)
      .in("status", statuses)
      .order("created_at", { ascending: false })
      .range(offset, offset + CHUNK - 1);
    if (error) throw error;
    const batch = (data ?? []) as { status?: string }[];
    for (const row of batch) {
      const s = row.status;
      if (typeof s === "string" && typeof counts[s] === "number") counts[s] += 1;
    }
    if (batch.length < CHUNK) break;
  }

  return counts;
}

/**
 * Job `reference` values overlapping the period (non-deleted, not status deleted) — for pulling linked invoices.
 */
export async function fetchJobReferencesOverlappingPeriod(range: { from: string; to: string }): Promise<string[]> {
  const supabase = createClient();
  const refs = new Set<string>();
  for (let offset = 0; ; offset += CHUNK) {
    const { data, error } = await supabase
      .from("jobs")
      .select(
        "reference,status,created_at,scheduled_date,scheduled_finish_date,scheduled_start_at,scheduled_end_at,completed_date",
      )
      .is("deleted_at", null)
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .range(offset, offset + CHUNK - 1);
    if (error) throw error;
    const batch = (data ?? []) as (JobPeriodOverlapRow & { reference?: string })[];
    for (const row of batch) {
      if (!jobExecutionOverlapsYmdRange(row, range.from, range.to)) continue;
      const r = row.reference?.trim();
      if (r) refs.add(r);
    }
    if (batch.length < CHUNK) break;
  }
  return [...refs];
}
