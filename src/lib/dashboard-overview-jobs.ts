import { getSupabase } from "@/services/base";
import { isPostgrestSelectSchemaError, isPostgrestWriteRetryableError } from "@/lib/postgrest-errors";

/** Jobs aligned with Jobs Management: not deleted, not cancelled/lost, optional created_at window. */
export type OverviewPipelineJobRow = {
  id: string;
  client_id?: string | null;
  owner_name?: string | null;
  partner_name?: string | null;
  title?: string | null;
  client_price: number;
  extras_amount?: number | null;
  partner_cost: number;
  materials_cost: number;
  commission?: number | null;
  status: string;
  created_at?: string;
  scheduled_date?: string | null;
  scheduled_finish_date?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  completed_date?: string | null;
};

const SELECT_FULL =
  "id, client_id, owner_name, partner_name, title, client_price, extras_amount, partner_cost, materials_cost, commission, status, created_at";
const SELECT_LEGACY =
  "id, client_id, partner_name, title, client_price, partner_cost, materials_cost, commission, status, created_at";

const SELECT_EXEC_FULL =
  `${SELECT_FULL}, scheduled_date, scheduled_finish_date, scheduled_start_at, scheduled_end_at, completed_date`;
const SELECT_EXEC_LEGACY = SELECT_FULL;

/**
 * CEO / dashboard “Sales”: jobs whose `created_at` falls in the range (official sale date).
 * Same broad universe as pipeline KPIs: not soft-deleted, not cancelled, not trash status.
 */
export async function fetchPipelineJobsForDashboard(
  supabase: ReturnType<typeof getSupabase>,
  bounds: { fromIso: string; toIso: string } | null,
): Promise<OverviewPipelineJobRow[]> {
  async function run(cols: string) {
    let q = supabase
      .from("jobs")
      .select(cols)
      .is("deleted_at", null)
      .neq("status", "cancelled")
      .neq("status", "deleted");
    if (bounds) {
      q = q.gte("created_at", bounds.fromIso).lte("created_at", bounds.toIso);
    }
    return q;
  }

  let res = await run(SELECT_FULL);
  if (res.error && isPostgrestWriteRetryableError(res.error)) {
    res = await run(SELECT_LEGACY);
  }
  if (res.error) throw res.error;

  const rows = (res.data ?? []) as unknown as OverviewPipelineJobRow[];
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

function ymdFromDbField(s: string | null | undefined): string | null {
  if (s == null || !String(s).trim()) return null;
  const t = String(s).trim();
  return t.length >= 10 ? t.slice(0, 10) : null;
}

/**
 * Best-effort execution window for overlap with a selected period:
 * start = scheduled_start_at → scheduled_date → created_at;
 * end = scheduled_finish_date → scheduled_end_at → completed_date → start.
 */
export function jobExecutionWindowYmd(row: OverviewPipelineJobRow): { start: string; end: string } {
  const created = ymdFromDbField(row.created_at) ?? "1970-01-01";
  const start =
    ymdFromDbField(row.scheduled_start_at) ??
    ymdFromDbField(row.scheduled_date) ??
    created;
  let end =
    ymdFromDbField(row.scheduled_finish_date) ??
    ymdFromDbField(row.scheduled_end_at) ??
    ymdFromDbField(row.completed_date) ??
    start;
  if (end < start) end = start;
  return { start, end };
}

const TERMINAL_JOB_STATUSES = new Set<string>(["completed", "cancelled", "deleted"]);

function hasExecutionScheduleSignal(row: OverviewPipelineJobRow): boolean {
  return Boolean(
    ymdFromDbField(row.scheduled_date) ||
      ymdFromDbField(row.scheduled_start_at) ||
      ymdFromDbField(row.scheduled_finish_date) ||
      ymdFromDbField(row.scheduled_end_at) ||
      ymdFromDbField(row.completed_date),
  );
}

/**
 * True if the job’s work is treated as overlapping [fromDay, toDay] (inclusive YYYY-MM-DD).
 * - With schedule/completion signals: strict interval overlap from {@link jobExecutionWindowYmd}.
 * - Active jobs with **no** schedule/finish/completion: treat as still running through **end of the
 *   selected period** (so March bookings still show in April when they remain open — matches ops reality).
 * - Otherwise: strict window (e.g. completed jobs with only created_at).
 */
export function jobExecutionOverlapsYmdRange(row: OverviewPipelineJobRow, fromDay: string, toDay: string): boolean {
  const active = !TERMINAL_JOB_STATUSES.has(row.status);

  if (hasExecutionScheduleSignal(row)) {
    const { start, end } = jobExecutionWindowYmd(row);
    return start <= toDay && end >= fromDay;
  }

  if (active) {
    const start = ymdFromDbField(row.created_at) ?? "1970-01-01";
    const effectiveEnd = toDay;
    return start <= toDay && effectiveEnd >= fromDay;
  }

  const { start, end } = jobExecutionWindowYmd(row);
  return start <= toDay && end >= fromDay;
}

/** YYYY-MM-DD of execution start (for weekly charts). */
export function jobExecutionStartYmd(row: OverviewPipelineJobRow): string {
  return jobExecutionWindowYmd(row).start;
}

/**
 * Executive / operations revenue: jobs whose execution window overlaps the dashboard range.
 * Loads all eligible jobs (no server-side date prefilter): previous AND-of-OR filters dropped rows
 * created before the period but still active in it.
 */
export async function fetchExecutiveRevenueJobsForDashboard(
  supabase: ReturnType<typeof getSupabase>,
  bounds: { fromIso: string; toIso: string } | null,
): Promise<OverviewPipelineJobRow[]> {
  const fromDay = bounds?.fromIso.slice(0, 10) ?? "1900-01-01";
  const toDay = bounds?.toIso.slice(0, 10) ?? "2099-12-31";

  async function run(cols: string) {
    return supabase
      .from("jobs")
      .select(cols)
      .is("deleted_at", null)
      .neq("status", "cancelled")
      .neq("status", "deleted");
  }

  let res = await run(SELECT_EXEC_FULL);
  if (res.error && isPostgrestSelectSchemaError(res.error)) {
    res = await run(SELECT_EXEC_LEGACY);
  }
  if (res.error && isPostgrestWriteRetryableError(res.error)) {
    res = await run(SELECT_LEGACY);
  }
  if (res.error) throw res.error;

  const rows = (res.data ?? []) as unknown as OverviewPipelineJobRow[];
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  if (!bounds) return deduped;
  return deduped.filter((r) => jobExecutionOverlapsYmdRange(r, fromDay, toDay));
}

/** Default monthly sales target when DB and env are unset (scaled to the selected period). */
export function defaultMonthlySalesGoalGbp(): number {
  const raw = process.env.NEXT_PUBLIC_DASHBOARD_SALES_GOAL_MONTHLY_GBP;
  const n = raw != null && raw !== "" ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 35_000;
}

/** Prefer company_settings; fallback to env default. */
export function resolveMonthlySalesGoalFromCompany(settings: { dashboard_sales_goal_monthly?: number | null } | null): number {
  const db = settings?.dashboard_sales_goal_monthly;
  if (db != null && Number.isFinite(Number(db)) && Number(db) > 0) return Number(db);
  return defaultMonthlySalesGoalGbp();
}

export function periodSalesGoalGbp(bounds: { fromIso: string; toIso: string } | null, monthlyGoal: number): number | null {
  if (!bounds) return null;
  const a = new Date(`${bounds.fromIso.slice(0, 10)}T12:00:00`);
  const b = new Date(`${bounds.toIso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return null;
  const days = Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
  return Math.round(((monthlyGoal * days) / 30.44) * 100) / 100;
}
