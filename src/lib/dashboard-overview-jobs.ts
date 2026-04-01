import { getSupabase } from "@/services/base";
import { isPostgrestWriteRetryableError } from "@/lib/postgrest-errors";

/** Jobs aligned with Jobs Management: not deleted, not cancelled/lost, optional created_at window. */
export type OverviewPipelineJobRow = {
  id: string;
  client_id?: string | null;
  owner_name?: string | null;
  partner_name?: string | null;
  client_price: number;
  extras_amount?: number | null;
  partner_cost: number;
  materials_cost: number;
  commission?: number | null;
  status: string;
  created_at?: string;
};

const SELECT_FULL =
  "id, client_id, owner_name, partner_name, client_price, extras_amount, partner_cost, materials_cost, commission, status, created_at";
const SELECT_LEGACY =
  "id, client_id, partner_name, client_price, partner_cost, materials_cost, commission, status, created_at";

/**
 * Same universe as Jobs Management list: excludes cancelled (incl. lost & cancelled tab).
 * Date filter: `created_at` within dashboard bounds (matches dashboard job filter chips). All time = no date filter.
 */
export async function fetchPipelineJobsForDashboard(
  supabase: ReturnType<typeof getSupabase>,
  bounds: { fromIso: string; toIso: string } | null,
): Promise<OverviewPipelineJobRow[]> {
  async function run(cols: string) {
    let q = supabase.from("jobs").select(cols).is("deleted_at", null).neq("status", "cancelled");
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

/** Default monthly sales target for the progress bar (scaled to the selected period). */
export function defaultMonthlySalesGoalGbp(): number {
  const raw = process.env.NEXT_PUBLIC_DASHBOARD_SALES_GOAL_MONTHLY_GBP;
  const n = raw != null && raw !== "" ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 35_000;
}

export function periodSalesGoalGbp(bounds: { fromIso: string; toIso: string } | null, monthlyGoal: number): number | null {
  if (!bounds) return null;
  const a = new Date(`${bounds.fromIso.slice(0, 10)}T12:00:00`);
  const b = new Date(`${bounds.toIso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return null;
  const days = Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
  return Math.round(((monthlyGoal * days) / 30.44) * 100) / 100;
}
