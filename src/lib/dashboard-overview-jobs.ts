import { getSupabase } from "@/services/base";
import { isPostgrestSelectSchemaError, isPostgrestWriteRetryableError } from "@/lib/postgrest-errors";
import { jobExecutionOverlapsYmdRange, jobScheduleStartInYmdRange } from "@/lib/job-period-overlap";
import type { CommissionTier } from "@/types/database";

export {
  jobExecutionOverlapsYmdRange,
  jobExecutionWindowYmd,
  jobExecutionStartYmd,
} from "@/lib/job-period-overlap";

/** Pipeline jobs included in dashboard “booked revenue” (excludes completed, cancelled, deleted). */
export const DASHBOARD_BOOKED_PIPELINE_STATUSES = [
  "unassigned",
  "auto_assigning",
  "scheduled",
  "late",
  "in_progress_phase1",
  "in_progress_phase2",
  "in_progress_phase3",
  "final_check",
  "awaiting_payment",
  "need_attention",
] as const;

const CHUNK = 800;

/**
 * In-flight request coalescing: multiple widgets requesting the same pipeline data within 5 s
 * share a single fetch. Prevents 4+ duplicate full-table scans on dashboard load.
 */
const pipelineJobsInflight = new Map<string, { promise: Promise<OverviewPipelineJobRow[]>; at: number }>();
const PIPELINE_COALESCE_TTL_MS = 5_000;

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
  /** Set when the job was created from an accepted quote (conversion funnel). */
  quote_id?: string | null;
  partner_agreed_value?: number | null;
  margin_percent?: number | null;
};

const SELECT_FULL =
  "id, client_id, owner_name, partner_name, title, client_price, extras_amount, partner_cost, materials_cost, partner_agreed_value, margin_percent, commission, status, created_at, quote_id";
const SELECT_LEGACY =
  "id, client_id, partner_name, title, client_price, partner_cost, materials_cost, margin_percent, commission, status, created_at, quote_id";
/** Oldest job rows may not have `quote_id`; omit for schema compatibility. */
const SELECT_LEGACY_NO_QUOTE =
  "id, client_id, partner_name, title, client_price, partner_cost, materials_cost, margin_percent, commission, status, created_at";

const SELECT_EXEC_FULL =
  `${SELECT_FULL}, scheduled_date, scheduled_finish_date, scheduled_start_at, scheduled_end_at, completed_date`;
const SELECT_EXEC_LEGACY = SELECT_FULL;

/**
 * Dashboard booked revenue: pipeline jobs whose **schedule start day** falls in the selected range
 * (same rule as Jobs Management “Schedule window”: {@link jobScheduleStartInYmdRange}).
 * Soft-deleted rows excluded; statuses are {@link DASHBOARD_BOOKED_PIPELINE_STATUSES} (not completed).
 * When `bounds` is null, all matching pipeline jobs are included (no date filter).
 */
export function fetchPipelineJobsForDashboard(
  supabase: ReturnType<typeof getSupabase>,
  bounds: { fromIso: string; toIso: string } | null,
): Promise<OverviewPipelineJobRow[]> {
  const cacheKey = bounds ? `${bounds.fromIso}|${bounds.toIso}` : "all";
  const cached = pipelineJobsInflight.get(cacheKey);
  if (cached && Date.now() - cached.at < PIPELINE_COALESCE_TTL_MS) {
    return cached.promise;
  }
  const promise = _fetchPipelineJobsForDashboard(supabase, bounds);
  pipelineJobsInflight.set(cacheKey, { promise, at: Date.now() });
  return promise;
}

async function _fetchPipelineJobsForDashboard(
  supabase: ReturnType<typeof getSupabase>,
  bounds: { fromIso: string; toIso: string } | null,
): Promise<OverviewPipelineJobRow[]> {
  const statusList = [...DASHBOARD_BOOKED_PIPELINE_STATUSES];
  const fromDay = bounds?.fromIso.slice(0, 10) ?? null;
  const toDay = bounds?.toIso.slice(0, 10) ?? null;

  async function loadChunked(cols: string): Promise<OverviewPipelineJobRow[]> {
    const seen = new Set<string>();
    const out: OverviewPipelineJobRow[] = [];
    for (let offset = 0; ; offset += CHUNK) {
      const { data, error } = await supabase
        .from("jobs")
        .select(cols)
        .is("deleted_at", null)
        .in("status", statusList)
        .order("created_at", { ascending: false })
        .range(offset, offset + CHUNK - 1);
      if (error) throw error;
      const batch = (data ?? []) as unknown as OverviewPipelineJobRow[];
      for (const r of batch) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r);
      }
      if (batch.length < CHUNK) break;
    }
    return out;
  }

  const columnAttempts = [SELECT_EXEC_FULL, SELECT_EXEC_LEGACY, SELECT_LEGACY, SELECT_LEGACY_NO_QUOTE];
  let rows: OverviewPipelineJobRow[] = [];
  let loaded = false;
  let lastErr: unknown;
  for (const cols of columnAttempts) {
    try {
      rows = await loadChunked(cols);
      loaded = true;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!loaded) throw lastErr instanceof Error ? lastErr : new Error("Failed to load pipeline jobs for dashboard");

  if (!bounds || fromDay == null || toDay == null) return rows;

  return rows.filter((r) => jobScheduleStartInYmdRange(r, fromDay, toDay));
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

export type CompanySalesGoalSettings = {
  dashboard_sales_goal_monthly?: number | null;
} | null;

/**
 * `monthlyGbpBrowserOverride`: optional £/month from localStorage (wins over tier + company).
 * Then tier `sales_goal_monthly` if `preferredTierNumber` matches.
 * Else `dashboard_sales_goal_monthly`; else env default.
 */
export function resolveMonthlySalesGoalFromCompany(
  settings: CompanySalesGoalSettings,
  tiers?: CommissionTier[] | null,
  preferredTierNumber?: number | null,
  monthlyGbpBrowserOverride?: number | null,
): number {
  const override = monthlyGbpBrowserOverride ?? null;
  if (override != null && Number.isFinite(override) && override > 0) return Number(override);

  const tn = preferredTierNumber ?? null;
  if (tn != null && tiers && tiers.length > 0) {
    const t = tiers.find((x) => Number(x.tier_number) === tn);
    const g = t?.sales_goal_monthly;
    if (g != null && Number.isFinite(Number(g)) && Number(g) > 0) return Number(g);
  }
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
