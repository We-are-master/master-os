import type { AccountLegacyYearlyStat, Job } from "@/types/database";

export type AccountYearRowSource = "previous_system" | "master_os";

export interface AccountYearBreakdownRow {
  year: number;
  source: AccountYearRowSource;
  jobs: number;
  revenue: number;
  /** Present for editable legacy rows. */
  legacyStatId?: string | null;
  notes?: string | null;
}

export interface AccountRelationshipInsights {
  customerSinceYear: number | null;
  totalJobsAllTime: number;
  totalRevenueAllTime: number;
  avgTicket: number;
  legacyJobs: number;
  legacyRevenue: number;
  osCompletedJobs: number;
  osCompletedRevenue: number;
  yearRows: AccountYearBreakdownRow[];
}

function jobCompletedRevenue(job: Job): number {
  return Number(job.client_price ?? 0) + Number(job.extras_amount ?? 0);
}

export function sumLegacyRevenue(legacyRows: AccountLegacyYearlyStat[]): number {
  return (legacyRows ?? []).reduce((s, r) => s + Number(r.revenue_gbp ?? 0), 0);
}

/** All-time revenue with Fixfy: pre–Master OS imports + current OS billable. */
export function accountRelationshipRevenueTotal(
  osBillable: number,
  legacyRevenue: number,
): number {
  return Math.round((Number(osBillable || 0) + Number(legacyRevenue || 0)) * 100) / 100;
}

export const ACCOUNT_REVENUE_RANK_MEDALS: Record<number, string> = {
  1: "🥇",
  2: "🥈",
  3: "🥉",
};

export function accountRevenueRankMedal(rank: number | null | undefined): string | null {
  if (rank == null || rank < 1 || rank > 3) return null;
  return ACCOUNT_REVENUE_RANK_MEDALS[rank] ?? null;
}

export function sumLegacyRevenueMap(legacyRevenueByAccount: Record<string, number>): number {
  return Object.values(legacyRevenueByAccount).reduce((sum, value) => sum + Number(value || 0), 0);
}

/** Top-N revenue ranks across the full filtered account set (OS billable + legacy). */
export function buildAccountRevenueRankMap(
  accounts: Array<{ id: string; total_revenue: number }>,
  legacyRevenueByAccount: Record<string, number>,
  maxRanks = 3,
): Map<string, number> {
  const map = new Map<string, number>();
  if (maxRanks <= 0 || accounts.length === 0) return map;

  const sorted = [...accounts].sort((a, b) => {
    const revA = accountRelationshipRevenueTotal(
      a.total_revenue,
      legacyRevenueByAccount[a.id] ?? 0,
    );
    const revB = accountRelationshipRevenueTotal(
      b.total_revenue,
      legacyRevenueByAccount[b.id] ?? 0,
    );
    return revB - revA;
  });

  sorted.slice(0, maxRanks).forEach((account, index) => {
    map.set(account.id, index + 1);
  });
  return map;
}

function yearFromIso(iso: string | null | undefined): number | null {
  if (!iso?.trim()) return null;
  const y = Number.parseInt(iso.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

function yearFromAccountCreated(createdAt: string | null | undefined): number | null {
  return yearFromIso(createdAt);
}

export function computeAccountRelationshipInsights(input: {
  legacyRows: AccountLegacyYearlyStat[];
  jobs: Job[];
  accountCreatedAt: string;
}): AccountRelationshipInsights {
  const legacyRows = input.legacyRows ?? [];
  const jobs = input.jobs ?? [];

  const legacyJobs = legacyRows.reduce((s, r) => s + Number(r.completed_jobs_count ?? 0), 0);
  const legacyRevenue = legacyRows.reduce((s, r) => s + Number(r.revenue_gbp ?? 0), 0);

  const osCompleted = jobs.filter((j) => j.status === "completed" && !j.deleted_at);
  const osCompletedJobs = osCompleted.length;
  const osCompletedRevenue = osCompleted.reduce((s, j) => s + jobCompletedRevenue(j), 0);

  const osByYear = new Map<number, { jobs: number; revenue: number }>();
  for (const job of osCompleted) {
    const y =
      yearFromIso(job.updated_at) ??
      yearFromIso(job.scheduled_finish_date) ??
      yearFromIso(job.scheduled_start_at) ??
      yearFromIso(job.created_at);
    if (y == null) continue;
    const cur = osByYear.get(y) ?? { jobs: 0, revenue: 0 };
    cur.jobs += 1;
    cur.revenue += jobCompletedRevenue(job);
    osByYear.set(y, cur);
  }

  const yearRows: AccountYearBreakdownRow[] = [];

  for (const row of legacyRows) {
    yearRows.push({
      year: row.year,
      source: "previous_system",
      jobs: Number(row.completed_jobs_count ?? 0),
      revenue: Number(row.revenue_gbp ?? 0),
      legacyStatId: row.id,
      notes: row.notes ?? null,
    });
  }

  for (const [year, agg] of osByYear.entries()) {
    yearRows.push({
      year,
      source: "master_os",
      jobs: agg.jobs,
      revenue: agg.revenue,
    });
  }

  yearRows.sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    if (a.source === b.source) return 0;
    return a.source === "previous_system" ? -1 : 1;
  });

  const legacyYears = legacyRows.map((r) => r.year);
  const customerSinceYear =
    legacyYears.length > 0
      ? Math.min(...legacyYears)
      : yearFromAccountCreated(input.accountCreatedAt);

  const totalJobsAllTime = legacyJobs + osCompletedJobs;
  const totalRevenueAllTime = legacyRevenue + osCompletedRevenue;
  const avgTicket = totalJobsAllTime > 0 ? totalRevenueAllTime / totalJobsAllTime : 0;

  return {
    customerSinceYear,
    totalJobsAllTime,
    totalRevenueAllTime,
    avgTicket,
    legacyJobs,
    legacyRevenue,
    osCompletedJobs,
    osCompletedRevenue,
    yearRows,
  };
}
