import { getSupabase } from "@/services/base";
import { isPostgrestSelectSchemaError, isPostgrestWriteRetryableError } from "@/lib/postgrest-errors";
import { jobExecutionOverlapsYmdRange } from "@/lib/job-period-overlap";

export {
  jobExecutionOverlapsYmdRange,
  jobExecutionWindowYmd,
  jobExecutionStartYmd,
} from "@/lib/job-period-overlap";

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
