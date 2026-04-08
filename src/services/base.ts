import { createClient } from "@/lib/supabase/client";
import { localYmdBoundsToUtcIso } from "@/lib/schedule-calendar";
import { JOB_ONSITE_PROGRESS_STATUSES } from "@/lib/job-phases";
import { getJobStatusCountsByChunkedSelect, getJobStatusCountsWithScheduleOverlap } from "./job-period-overlap-queries";

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
  /** Inclusive bounds for `timestamptz` columns (local calendar day → UTC ISO). Overrides dateFrom/dateTo when set. */
  dateFromUtcIso?: string;
  dateToUtcIso?: string;
  /** Column used for date range filtering (e.g. `scheduled_date`). */
  dateColumn?: string;
  /**
   * Jobs only: overlap with selected local-day range (execution / booking window — same rules as Executive snapshot).
   * Listing uses chunked fetch + client filter; counts use the same overlap helper.
   */
  scheduleRange?: { from: string; to: string };
  /** Soft-deleted rows only (`deleted_at` set). Used for the Jobs "Archived" tab. */
  archivedOnly?: boolean;
  /**
   * Jobs only: Unassigned tab — `unassigned` / `auto_assigning` OR booked pipeline rows with no partner.
   * When set, do not pass `statusIn` (this replaces the status filter).
   */
  jobsUnassignedPipelineTab?: boolean;
  /** Jobs only: Scheduled / In progress tabs — require `partner_id` or non-empty `partner_ids`. */
  jobsRequirePartnerSet?: boolean;
  /**
   * Invoices: period matches rows where `billing_week_start` is in [from,to] (weekly batch),
   * or `billing_week_start` is null and `created_at` falls in the local-day UTC window.
   */
  invoicePeriodBounds?: { from: string; to: string; startIso: string; endIso: string };
}

/**
 * PostgREST `or` filter: job **start** falls in the window — same priority as `jobExecutionStartYmd`:
 * `scheduled_start_at` (instant in local-day UTC bounds), else `scheduled_date`, else `created_at`.
 */
export function applyJobsScheduleRangeToQuery<T extends { or: (filters: string) => T }>(
  query: T,
  range: { from: string; to: string }
): T {
  const { startIso, endIso } = localYmdBoundsToUtcIso(range.from, range.to);
  const byStartAt = `and(scheduled_start_at.not.is.null,scheduled_start_at.gte."${startIso}",scheduled_start_at.lte."${endIso}")`;
  const byDateOnly = `and(scheduled_start_at.is.null,scheduled_date.not.is.null,scheduled_date.gte.${range.from},scheduled_date.lte.${range.to})`;
  const byCreated = `and(scheduled_start_at.is.null,scheduled_date.is.null,created_at.gte."${startIso}",created_at.lte."${endIso}")`;
  return query.or(`${byStartAt},${byDateOnly},${byCreated}`);
}

/**
 * Invoices: rows with any “activity” touching the period — billing week, created (non-weekly),
 * due date, last customer payment, or paid date.
 */
export function applyInvoicePeriodBoundsToQuery<T extends { or: (filters: string) => T }>(
  query: T,
  bounds: { from: string; to: string; startIso: string; endIso: string }
): T {
  const { from, to, startIso, endIso } = bounds;
  const byWeek = `and(billing_week_start.gte.${from},billing_week_start.lte.${to})`;
  const byCreated = `and(billing_week_start.is.null,created_at.gte."${startIso}",created_at.lte."${endIso}")`;
  const byDue = `and(due_date.gte.${from},due_date.lte.${to})`;
  const byLastPay = `and(last_payment_date.gte.${from},last_payment_date.lte.${to})`;
  const byPaid = `and(paid_date.gte.${from},paid_date.lte.${to})`;
  return query.or(`${byWeek},${byCreated},${byDue},${byLastPay},${byPaid}`);
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

/** Cache which tables have a `deleted_at` column to avoid repeated probe queries. */
const deletedAtColumnCache = new Map<string, boolean>();

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

  let query = supabase.from(table).select("*", { count: "exact" });
  if (params.archivedOnly) {
    query = query.not("deleted_at", "is", null);
  } else {
    query = query.is("deleted_at", null);
  }

  const uTab = params.jobsUnassignedPipelineTab;
  const reqPartner = params.jobsRequirePartnerSet;

  if (table === "jobs" && uTab) {
    const onsites = JOB_ONSITE_PROGRESS_STATUSES.join(",");
    query = query.or(
      `status.in.(unassigned,auto_assigning),` +
        `and(status.in.(scheduled,late,${onsites}),partner_id.is.null,partner_ids.eq.{})`,
    );
  } else if (params.statusIn && params.statusIn.length > 0) {
    query = query.in("status", params.statusIn);
  } else if (params.status && params.status !== "all") {
    query = query.eq("status", params.status);
  }

  if (table === "jobs" && reqPartner) {
    query = query.or("partner_id.not.is.null,partner_ids.neq.{}");
  }

  if (params.search && options?.searchColumns?.length) {
    const orConditions = options.searchColumns
      .map((col) => `${col}.ilike.%${params.search}%`)
      .join(",");
    query = query.or(orConditions);
  }

  if (params.scheduleRange) {
    query = applyJobsScheduleRangeToQuery(query, params.scheduleRange);
  } else if (params.invoicePeriodBounds) {
    query = applyInvoicePeriodBoundsToQuery(query, params.invoicePeriodBounds);
  } else if (params.dateColumn) {
    if (params.dateFromUtcIso) query = query.gte(params.dateColumn, params.dateFromUtcIso);
    else if (params.dateFrom) query = query.gte(params.dateColumn, params.dateFrom);
    if (params.dateToUtcIso) query = query.lte(params.dateColumn, params.dateToUtcIso);
    else if (params.dateTo) query = query.lte(params.dateColumn, params.dateTo);
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
  options?: {
    dateFrom?: string;
    dateTo?: string;
    dateFromUtcIso?: string;
    dateToUtcIso?: string;
    dateColumn?: string;
    scheduleRange?: { from: string; to: string };
    invoicePeriodBounds?: { from: string; to: string; startIso: string; endIso: string };
  }
): Promise<Record<string, number>> {
  const supabase = getSupabase();
  const counts: Record<string, number> = {};
  const canUseRpc = !options?.scheduleRange && !options?.invoicePeriodBounds;

  if (table === "jobs" && options?.scheduleRange) {
    return getJobStatusCountsWithScheduleOverlap(statuses, options.scheduleRange);
  }

  const jobsNoDateFilter =
    !options?.dateColumn &&
    !options?.dateFrom &&
    !options?.dateTo &&
    !options?.dateFromUtcIso &&
    !options?.dateToUtcIso;

  if (table === "jobs" && canUseRpc && jobsNoDateFilter) {
    return getJobStatusCountsByChunkedSelect(statuses);
  }

  if (canUseRpc && table !== "jobs") {
    const { data: rpcRows, error: rpcErr } = await supabase.rpc("get_status_counts", {
      p_table_name: table,
      p_statuses: statuses,
      p_status_column: statusColumn,
      p_date_column: options?.dateColumn ?? null,
      p_date_from: options?.dateFrom ?? null,
      p_date_to: options?.dateTo ?? null,
    });
    if (!rpcErr && Array.isArray(rpcRows)) {
      let totalFromRpc = 0;
      for (const row of rpcRows as Array<{ status?: string; count?: number | string; total?: number | string }>) {
        const st = typeof row.status === "string" ? row.status : "";
        const ct = Number(row.count ?? 0) || 0;
        if (st) counts[st] = ct;
        const rowTotal = Number(row.total ?? 0) || 0;
        if (rowTotal > totalFromRpc) totalFromRpc = rowTotal;
      }
      const sumByStatus = statuses.reduce((acc, st) => acc + (counts[st] ?? 0), 0);
      counts["all"] = totalFromRpc > 0 ? totalFromRpc : sumByStatus;
      for (const st of statuses) {
        if (counts[st] == null) counts[st] = 0;
      }
      return counts;
    }
  }

  /** Matches `getAggregates`: some tables (e.g. `partners`) have no `deleted_at` column. */
  let useDeletedFilter: boolean;
  if (deletedAtColumnCache.has(table)) {
    useDeletedFilter = deletedAtColumnCache.get(table)!;
  } else {
    const deletedProbe = await supabase.from(table).select("*", { count: "exact", head: true }).is("deleted_at", null);
    useDeletedFilter = !deletedProbe.error;
    deletedAtColumnCache.set(table, useDeletedFilter);
  }

  let totalQuery = supabase.from(table).select("*", { count: "exact", head: true });
  if (useDeletedFilter) totalQuery = totalQuery.is("deleted_at", null);
  if (options?.scheduleRange && table === "jobs") {
    totalQuery = applyJobsScheduleRangeToQuery(totalQuery, options.scheduleRange);
  } else if (options?.invoicePeriodBounds) {
    totalQuery = applyInvoicePeriodBoundsToQuery(totalQuery, options.invoicePeriodBounds);
  } else if (options?.dateColumn) {
    if (options.dateFromUtcIso) totalQuery = totalQuery.gte(options.dateColumn, options.dateFromUtcIso);
    else if (options.dateFrom) totalQuery = totalQuery.gte(options.dateColumn, options.dateFrom);
    if (options.dateToUtcIso) totalQuery = totalQuery.lte(options.dateColumn, options.dateToUtcIso);
    else if (options.dateTo) totalQuery = totalQuery.lte(options.dateColumn, options.dateTo);
  }
  const { count: totalCount } = await totalQuery;
  counts["all"] = totalCount ?? 0;

  await Promise.all(
    statuses.map(async (s) => {
      let statusQuery = supabase.from(table).select("*", { count: "exact", head: true }).eq(statusColumn, s);
      if (useDeletedFilter) statusQuery = statusQuery.is("deleted_at", null);
      if (options?.scheduleRange && table === "jobs") {
        statusQuery = applyJobsScheduleRangeToQuery(statusQuery, options.scheduleRange);
      } else if (options?.invoicePeriodBounds) {
        statusQuery = applyInvoicePeriodBoundsToQuery(statusQuery, options.invoicePeriodBounds);
      } else if (options?.dateColumn) {
        if (options.dateFromUtcIso) statusQuery = statusQuery.gte(options.dateColumn, options.dateFromUtcIso);
        else if (options.dateFrom) statusQuery = statusQuery.gte(options.dateColumn, options.dateFrom);
        if (options.dateToUtcIso) statusQuery = statusQuery.lte(options.dateColumn, options.dateToUtcIso);
        else if (options.dateTo) statusQuery = statusQuery.lte(options.dateColumn, options.dateTo);
      }
      const { count } = await statusQuery;
      counts[s] = count ?? 0;
    })
  );

  return counts;
}

/**
 * Sum + row count for KPIs. Avoids `count:id.count()` combined with `.sum()` — that shape returns 400 on several PostgREST / Kong stacks.
 */
export async function getAggregates(
  table: string,
  column: string
): Promise<{ sum: number; count: number }> {
  const supabase = getSupabase();
  const pageSize = 2000;

  let useDeletedFilter: boolean;
  if (deletedAtColumnCache.has(table)) {
    useDeletedFilter = deletedAtColumnCache.get(table)!;
  } else {
    const probe = await supabase.from(table).select("*", { count: "exact", head: true }).is("deleted_at", null);
    useDeletedFilter = !probe.error;
    deletedAtColumnCache.set(table, useDeletedFilter);
  }
  let countRes = useDeletedFilter
    ? await supabase.from(table).select("*", { count: "exact", head: true }).is("deleted_at", null)
    : await supabase.from(table).select("*", { count: "exact", head: true });
  if (countRes.error) throw countRes.error;
  const totalCount = countRes.count ?? 0;

  const sumQuery = supabase.from(table).select(`${column}.sum()`);
  const { data: sumRow, error: sumErr } = useDeletedFilter
    ? await sumQuery.is("deleted_at", null).maybeSingle()
    : await sumQuery.maybeSingle();

  if (!sumErr && sumRow != null && typeof sumRow === "object") {
    const row = sumRow as Record<string, unknown>;
    const raw = row[`${column}_sum`];
    if (raw != null && Number.isFinite(Number(raw))) {
      return { sum: Number(raw), count: totalCount };
    }
  }

  let sum = 0;
  for (let from = 0; ; from += pageSize) {
    let q = supabase.from(table).select(column).range(from, from + pageSize - 1);
    if (useDeletedFilter) q = q.is("deleted_at", null);
    const { data: rows, error } = await q;
    if (error) throw error;
    const batch = (rows ?? []) as unknown as Record<string, unknown>[];
    for (const r of batch) sum += Number(r[column]) || 0;
    if (batch.length < pageSize) break;
  }
  return { sum, count: totalCount };
}
