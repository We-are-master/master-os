import type { BeaconFilters } from "@/components/beacon/beacon-filters";
import {
  getBeaconScheduleYmdRange,
  resolveAccountClientIds,
} from "@/components/beacon/beacon-filters";
import { applyJobsScheduleRangeToQuery, getSupabase } from "@/services/base";

/** Active ops pipeline — same lifecycle as Jobs Management (excludes closed). */
export const BEACON_PIPELINE_STATUSES = [
  "unassigned",
  "auto_assigning",
  "scheduled",
  "late",
  "in_progress",
  "on_hold",
  "final_check",
  "need_attention",
] as const;

const TERMINAL_STATUSES = ["completed", "cancelled"] as const;

// PostgREST query builder — chained filters share one opaque type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JobsQuery = any;

function applyBeaconPartnerFilter(q: JobsQuery, partnerId: string): JobsQuery {
  if (partnerId === "__unassigned__") return q.is("partner_id", null);
  if (partnerId !== "all") return q.eq("partner_id", partnerId);
  return q;
}

function applyBeaconAccountFilter(q: JobsQuery, accountClientIds: string[] | null): JobsQuery {
  if (accountClientIds !== null) return q.in("client_id", accountClientIds);
  return q;
}

/**
 * Live Operations board fetch: pipeline jobs are loaded separately from
 * completed/cancelled so future unassigned rows are not pushed out by the
 * 200-row cap on terminal history.
 */
export async function fetchBeaconBoardJobs(
  filters: BeaconFilters,
  selectCols: string,
  options: { includeCancelled: boolean },
): Promise<Record<string, unknown>[]> {
  const accountClientIds = await resolveAccountClientIds(filters.accountId);
  if (accountClientIds !== null && accountClientIds.length === 0) return [];

  const scheduleYmd = getBeaconScheduleYmdRange(filters);
  const supabase = getSupabase();

  const build = () => {
    let q = supabase
      .from("jobs")
      .select(selectCols)
      .neq("status", "deleted")
      .is("deleted_at", null);
    q = applyBeaconPartnerFilter(q, filters.partnerId);
    q = applyBeaconAccountFilter(q, accountClientIds);
    if (scheduleYmd) q = applyJobsScheduleRangeToQuery(q, scheduleYmd);
    return q;
  };

  const { data: pipeline, error: pipeErr } = await build()
    .in("status", [...BEACON_PIPELINE_STATUSES])
    .order("scheduled_start_at", { ascending: true, nullsFirst: false })
    .limit(280);
  if (pipeErr) throw pipeErr;

  const terminalStatuses = options.includeCancelled
    ? [...TERMINAL_STATUSES]
    : (["completed"] as const);

  const { data: terminal, error: termErr } = await build()
    .in("status", [...terminalStatuses])
    .order("scheduled_start_at", { ascending: false, nullsFirst: false })
    .limit(120);
  if (termErr) throw termErr;

  const byId = new Map<string, Record<string, unknown>>();
  for (const row of [...(pipeline ?? []), ...(terminal ?? [])]) {
    const id = (row as { id?: string }).id;
    if (id) byId.set(id, row as Record<string, unknown>);
  }
  return [...byId.values()];
}
