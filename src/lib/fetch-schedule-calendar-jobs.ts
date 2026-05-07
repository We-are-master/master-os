import { getSupabase } from "@/services/base";
import type { Job, JobVisit } from "@/types/database";
import { formatLocalYmd, localYmdBoundsToUtcIso } from "@/lib/schedule-calendar";
import { isJobExcludedFromScheduleView } from "@/lib/schedule-visible-jobs";

function mergeFetchedScheduleRowsIntoJobs(
  byScheduledDate: Job[],
  byFinishDate: Job[],
  byStartAt: Job[],
  byEndAt: Job[],
  byVisits: Array<JobVisit & { parent: Job | null }>,
): Job[] {
  const merged = new Map<string, Job>();
  for (const row of [...byScheduledDate, ...byFinishDate, ...byStartAt, ...byEndAt]) {
    merged.set(row.id, row as Job);
  }
  for (const v of byVisits) {
    if (!v.parent) continue;
    const parent = v.parent;
    const synthetic: Job = {
      ...parent,
      id: v.id,
      reference: `${parent.reference} · V${v.visit_index}`,
      scheduled_date: v.scheduled_date ?? parent.scheduled_date,
      scheduled_start_at: v.scheduled_start_at ?? parent.scheduled_start_at,
      scheduled_end_at: v.scheduled_end_at ?? parent.scheduled_end_at,
      scheduled_finish_date: v.scheduled_date ?? parent.scheduled_finish_date,
      partner_id: v.partner_id ?? parent.partner_id,
      partner_name: v.partner_name ?? parent.partner_name,
      client_price: Number(v.client_price ?? 0),
      partner_cost: Number(v.partner_cost ?? 0),
      status:
        v.status === "in_progress"
          ? "in_progress"
          : v.status === "completed"
            ? "completed"
            : v.status === "cancelled"
              ? "cancelled"
              : "scheduled",
    };
    (synthetic as Job & { __visit_parent_id?: string; __visit_index?: number }).__visit_parent_id = parent.id;
    (synthetic as Job & { __visit_parent_id?: string; __visit_index?: number }).__visit_index = v.visit_index;
    merged.set(synthetic.id, synthetic);
  }
  const list = Array.from(merged.values()).filter((j) => !isJobExcludedFromScheduleView(j));
  list.sort((a, b) => {
    const ka = a.scheduled_start_at ?? (a.scheduled_date ? `${a.scheduled_date}T00:00:00` : "");
    const kb = b.scheduled_start_at ?? (b.scheduled_date ? `${b.scheduled_date}T00:00:00` : "");
    return ka.localeCompare(kb);
  });
  return list;
}

/** Core fetch: jobs overlapping `[padStart … padEnd]` (local `YYYY-MM-DD`) same merge as Live View. */
export async function fetchScheduleCalendarJobsOverlappingYmdRange(padStart: string, padEnd: string): Promise<Job[]> {
  const supabase = getSupabase();
  const { startIso: padStartUtc, endIso: padEndUtc } = localYmdBoundsToUtcIso(padStart, padEnd);

  const [byScheduledDate, byFinishDate, byStartAt, byEndAt, byVisits] = await Promise.all([
    supabase
      .from("jobs")
      .select("*")
      .is("deleted_at", null)
      .gte("scheduled_date", padStart)
      .lte("scheduled_date", padEnd)
      .order("scheduled_date", { ascending: true }),
    supabase
      .from("jobs")
      .select("*")
      .is("deleted_at", null)
      .not("scheduled_finish_date", "is", null)
      .gte("scheduled_finish_date", padStart)
      .lte("scheduled_finish_date", padEnd)
      .order("scheduled_finish_date", { ascending: true }),
    supabase
      .from("jobs")
      .select("*")
      .is("deleted_at", null)
      .not("scheduled_start_at", "is", null)
      .gte("scheduled_start_at", padStartUtc)
      .lte("scheduled_start_at", padEndUtc)
      .order("scheduled_start_at", { ascending: true }),
    supabase
      .from("jobs")
      .select("*")
      .is("deleted_at", null)
      .not("scheduled_end_at", "is", null)
      .gte("scheduled_end_at", padStartUtc)
      .lte("scheduled_end_at", padEndUtc)
      .order("scheduled_end_at", { ascending: true }),
    supabase
      .from("job_visits")
      .select("*, parent:job_id ( * )")
      .is("deleted_at", null)
      .neq("status", "cancelled")
      .gte("scheduled_date", padStart)
      .lte("scheduled_date", padEnd)
      .order("scheduled_date", { ascending: true }),
  ]);

  return mergeFetchedScheduleRowsIntoJobs(
    (byScheduledDate.data ?? []) as Job[],
    (byFinishDate.data ?? []) as Job[],
    (byStartAt.data ?? []) as Job[],
    (byEndAt.data ?? []) as Job[],
    (byVisits.data ?? []) as Array<JobVisit & { parent: Job | null }>,
  );
}

export async function fetchScheduleCalendarJobsForMonth(year: number, monthIndex0: number): Promise<Job[]> {
  const padStart = formatLocalYmd(new Date(year, monthIndex0, 1 - 62));
  const padEnd = formatLocalYmd(new Date(year, monthIndex0 + 1, 62));
  return fetchScheduleCalendarJobsOverlappingYmdRange(padStart, padEnd);
}

export async function fetchScheduleCalendarJobsForYear(year: number): Promise<Job[]> {
  const start = new Date(year, 0, 1);
  start.setDate(start.getDate() - 62);
  const end = new Date(year, 11, 31);
  end.setDate(end.getDate() + 62);
  return fetchScheduleCalendarJobsOverlappingYmdRange(formatLocalYmd(start), formatLocalYmd(end));
}

function startMondayLocal(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}

export async function fetchScheduleCalendarJobsForWeekAnchor(weekAnchor: Date): Promise<Job[]> {
  const mon = startMondayLocal(weekAnchor);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const padStart = formatLocalYmd(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() - 62));
  const padEnd = formatLocalYmd(new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + 62));
  return fetchScheduleCalendarJobsOverlappingYmdRange(padStart, padEnd);
}

export async function fetchScheduleCalendarJobsForDayAnchor(dayAnchor: Date): Promise<Job[]> {
  const x = new Date(dayAnchor);
  x.setHours(0, 0, 0, 0);
  const padStart = formatLocalYmd(new Date(x.getFullYear(), x.getMonth(), x.getDate() - 62));
  const padEnd = formatLocalYmd(new Date(x.getFullYear(), x.getMonth(), x.getDate() + 62));
  return fetchScheduleCalendarJobsOverlappingYmdRange(padStart, padEnd);
}
