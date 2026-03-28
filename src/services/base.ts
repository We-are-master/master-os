import { createClient } from "@/lib/supabase/client";
import { localYmdBoundsToUtcIso } from "@/lib/schedule-calendar";

export type SortDirection = "asc" | "desc";

export interface ListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  /** When set, filter with `.in("status", statusIn)` instead of a single `status` eq. */
  statusIn?: string[];
  sortBy?: string;
  sortDir?: SortDirection;
  /** Inclusive YYYY-MM-DD */
  dateFrom?: string;
  /** Inclusive YYYY-MM-DD */
  dateTo?: string;
  /** Column used for date range filtering (e.g. `scheduled_date`). */
  dateColumn?: string;
  /**
   * Jobs only: inclusive schedule window on local calendar days.
   * Matches if `scheduled_date` is in range OR `scheduled_start_at` falls within local start/end of range.
   */
  scheduleRange?: { from: string; to: string };
}

/** PostgREST `or` filter for jobs table schedule window (pairs with deleted_at / status filters via AND). */
export function applyJobsScheduleRangeToQuery<T extends { or: (filters: string) => T }>(
  query: T,
  range: { from: string; to: string }
): T {
  const { startIso, endIso } = localYmdBoundsToUtcIso(range.from, range.to);
  const byDate = `and(scheduled_date.gte.${range.from},scheduled_date.lte.${range.to})`;
  const byStart = `and(scheduled_start_at.gte."${startIso}",scheduled_start_at.lte."${endIso}")`;
  return query.or(`${byDate},${byStart}`);
}

export interface ListResult<T> {
  data: T[];
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function getSupabase() {
  return createClient();
}

export async function softDeleteById(
  table: string,
  id: string,
  deletedBy?: string
): Promise<void> {
  const supabase = getSupabase();
  const payload: { deleted_at: string; deleted_by?: string } = {
    deleted_at: new Date().toISOString(),
  };
  if (deletedBy) payload.deleted_by = deletedBy;
  const { error } = await supabase.from(table).update(payload).eq("id", id);
  if (error) throw error;
}

export async function queryList<T>(
  table: string,
  params: ListParams,
  options?: {
    searchColumns?: string[];
    defaultSort?: string;
  }
): Promise<ListResult<T>> {
  const supabase = getSupabase();
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 10;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase.from(table).select("*", { count: "exact" }).is("deleted_at", null);

  if (params.statusIn && params.statusIn.length > 0) {
    query = query.in("status", params.statusIn);
  } else if (params.status && params.status !== "all") {
    query = query.eq("status", params.status);
  }

  if (params.search && options?.searchColumns?.length) {
    const orConditions = options.searchColumns
      .map((col) => `${col}.ilike.%${params.search}%`)
      .join(",");
    query = query.or(orConditions);
  }

  if (params.scheduleRange) {
    query = applyJobsScheduleRangeToQuery(query, params.scheduleRange);
  } else if (params.dateColumn) {
    if (params.dateFrom) query = query.gte(params.dateColumn, params.dateFrom);
    if (params.dateTo) query = query.lte(params.dateColumn, params.dateTo);
  }

  const sortCol = params.sortBy ?? options?.defaultSort ?? "created_at";
  const sortDir = params.sortDir ?? "desc";
  query = query.order(sortCol, { ascending: sortDir === "asc" });

  query = query.range(from, to);

  const { data, error, count } = await query;

  if (error) throw error;

  return {
    data: (data ?? []) as T[],
    count: count ?? 0,
    page,
    pageSize,
    totalPages: Math.ceil((count ?? 0) / pageSize),
  };
}

export async function getStatusCounts(
  table: string,
  statuses: string[],
  statusColumn = "status",
  options?: { dateFrom?: string; dateTo?: string; dateColumn?: string; scheduleRange?: { from: string; to: string } }
): Promise<Record<string, number>> {
  const supabase = getSupabase();
  const counts: Record<string, number> = {};

  let totalQuery = supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .is("deleted_at", null);
  if (options?.scheduleRange && table === "jobs") {
    totalQuery = applyJobsScheduleRangeToQuery(totalQuery, options.scheduleRange);
  } else if (options?.dateColumn) {
    if (options.dateFrom) totalQuery = totalQuery.gte(options.dateColumn, options.dateFrom);
    if (options.dateTo) totalQuery = totalQuery.lte(options.dateColumn, options.dateTo);
  }
  const { count: totalCount } = await totalQuery;
  counts["all"] = totalCount ?? 0;

  await Promise.all(
    statuses.map(async (s) => {
      let statusQuery = supabase
        .from(table)
        .select("*", { count: "exact", head: true })
        .is("deleted_at", null)
        .eq(statusColumn, s);
      if (options?.scheduleRange && table === "jobs") {
        statusQuery = applyJobsScheduleRangeToQuery(statusQuery, options.scheduleRange);
      } else if (options?.dateColumn) {
        if (options.dateFrom) statusQuery = statusQuery.gte(options.dateColumn, options.dateFrom);
        if (options.dateTo) statusQuery = statusQuery.lte(options.dateColumn, options.dateTo);
      }
      const { count } = await statusQuery;
      counts[s] = count ?? 0;
    })
  );

  return counts;
}

export async function getAggregates(
  table: string,
  column: string
): Promise<{ sum: number; count: number }> {
  const supabase = getSupabase();
  // Use Postgres aggregate via PostgREST `select` with aggregate functions to avoid
  // fetching all rows into the client just to sum them.
  const { data, error } = await supabase
    .from(table)
    .select(`${column}.sum(), count:id.count()`)
    .is("deleted_at", null)
    .limit(1)
    .single();
  if (error) {
    // Fallback for tables without aggregate support (older PostgREST versions)
    const { data: rows, error: fallbackErr } = await supabase
      .from(table)
      .select(column)
      .is("deleted_at", null);
    if (fallbackErr) throw fallbackErr;
    const vals = ((rows ?? []) as unknown as Record<string, unknown>[]).map((r) => Number(r[column]) || 0);
    return { sum: vals.reduce((a, b) => a + b, 0), count: vals.length };
  }
  const row = data as unknown as Record<string, unknown>;
  return {
    sum: Number(row[`${column}_sum`] ?? row[column] ?? 0),
    count: Number(row["count"] ?? 0),
  };
}
