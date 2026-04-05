import { createClient } from "@/lib/supabase/client";
import { jobExecutionOverlapsYmdRange, type JobPeriodOverlapRow } from "@/lib/job-period-overlap";
import type { Job } from "@/types/database";

const CHUNK = 800;

/** Full rows for Jobs Management list when filtering by schedule period (client-side overlap). */
export async function loadAllJobsForPeriodOverlap(statusIn: string[], range: { from: string; to: string }): Promise<Job[]> {
  const supabase = createClient();
  const { from, to } = range;
  const out: Job[] = [];
  for (let offset = 0; ; offset += CHUNK) {
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .is("deleted_at", null)
      .in("status", statusIn)
      .order("created_at", { ascending: false })
      .range(offset, offset + CHUNK - 1);
    if (error) throw error;
    const batch = (data ?? []) as Job[];
    for (const j of batch) {
      if (jobExecutionOverlapsYmdRange(j, from, to)) out.push(j);
    }
    if (batch.length < CHUNK) break;
  }
  return out;
}

/** Tab counts when a schedule period is active — same overlap semantics as the job list. */
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
      if (!jobExecutionOverlapsYmdRange(row, range.from, range.to)) continue;
      const s = row.status;
      if (typeof counts[s] === "number") counts[s] += 1;
      counts["all"] += 1;
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
