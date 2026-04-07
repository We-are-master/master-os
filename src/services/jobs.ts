import { getSupabase, queryList, type ListParams, type ListResult, type SortDirection } from "./base";
import { loadAllJobsForPeriodOverlap } from "./job-period-overlap-queries";
import { jobScheduleStartInYmdRange } from "@/lib/job-period-overlap";
import type { Job } from "@/types/database";
import { cancelOpenInvoicesForJobCancellation, createInvoice } from "./invoices";
import { getInvoiceDueDateIsoForClient } from "./invoice-due-date";
import { syncSelfBillAfterJobChange } from "./self-bills";
import { JOB_ONSITE_PROGRESS_STATUSES } from "@/lib/job-phases";
import {
  applyJobDbCompat,
  isLegacyJobSchema,
  prepareJobRowForInsert,
  prepareJobRowForUpdate,
} from "@/lib/job-schema-compat";
import { isPostgrestWriteRetryableError } from "@/lib/postgrest-errors";
import { isSupabaseMissingColumnError } from "@/lib/supabase-schema-compat";
import {
  JOB_STATUSES_UNASSIGN_WHEN_PARTNER_CLEARED,
  jobHasPartnerSet,
  jobIsBookedPipelineWithoutPartner,
} from "@/lib/job-partner-assign";
import { resolveJobGeocode } from "@/lib/job-geocode-client";

/** Slim rows for Jobs Management KPIs (avg ticket, avg margin); loaded in chunks to avoid pagination bias. */
export type JobFinancialKpiRow = Pick<
  Job,
  | "status"
  | "partner_id"
  | "partner_ids"
  | "client_price"
  | "extras_amount"
  | "partner_cost"
  | "materials_cost"
  | "created_at"
  | "scheduled_date"
  | "scheduled_finish_date"
  | "scheduled_start_at"
  | "scheduled_end_at"
  | "completed_date"
>;

const KPI_CHUNK_COLS_FULL =
  "status,partner_id,partner_ids,client_price,extras_amount,partner_cost,materials_cost,created_at,scheduled_date,scheduled_finish_date,scheduled_start_at,scheduled_end_at,completed_date";
const KPI_CHUNK_COLS_LEGACY =
  "status,partner_id,partner_ids,client_price,partner_cost,materials_cost,created_at,scheduled_date,scheduled_start_at,scheduled_end_at,completed_date";

export async function fetchAllJobsFinancialKpiRows(
  scheduleRange?: { from: string; to: string } | null
): Promise<JobFinancialKpiRow[]> {
  const supabase = getSupabase();
  const chunk = 1000;
  let columns = KPI_CHUNK_COLS_FULL;
  const all: JobFinancialKpiRow[] = [];
  const fromY = scheduleRange?.from;
  const toY = scheduleRange?.to;
  for (let from = 0; ; from += chunk) {
    const run = async (cols: string) => {
      const q = supabase.from("jobs").select(cols).is("deleted_at", null);
      return q.order("created_at", { ascending: false }).range(from, from + chunk - 1);
    };
    let { data, error } = await run(columns);
    if (error && isPostgrestWriteRetryableError(error) && columns === KPI_CHUNK_COLS_FULL) {
      columns = KPI_CHUNK_COLS_LEGACY;
      ({ data, error } = await run(columns));
    }
    if (error && isPostgrestWriteRetryableError(error) && columns.includes("extras_amount")) {
      columns =
        "status,partner_id,partner_ids,client_price,partner_cost,materials_cost,created_at,scheduled_date,scheduled_start_at,scheduled_end_at,completed_date";
      ({ data, error } = await run(columns));
    }
    if (error) throw error;
    const rawBatch = (data ?? []) as unknown as JobFinancialKpiRow[];
    const batch =
      scheduleRange && fromY && toY
        ? rawBatch.filter((r) => jobScheduleStartInYmdRange(r, fromY, toY))
        : rawBatch;
    all.push(...batch);
    if (rawBatch.length < chunk) break;
  }
  return all;
}

// Throttle: mark-late should not run on every jobs list request.
let lastMarkLateAt = 0;
const MARK_LATE_INTERVAL_MS = 30 * 60 * 1000;

/** Jobs "All" tab: non-deleted rows only, excluding Lost & Cancelled (`cancelled`). */
export const JOB_LIST_ALL_TAB_STATUSES = [
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
  "completed",
] as const;

/** Same grouping as `listJobs` / Jobs Management tabs — used for KPI rows + counts. */
export function jobMatchesJobsManagementTab(jobStatus: string, tabId: string): boolean {
  if (tabId === "all") {
    return (JOB_LIST_ALL_TAB_STATUSES as readonly string[]).includes(jobStatus);
  }
  if (tabId === "unassigned") return jobStatus === "unassigned" || jobStatus === "auto_assigning";
  if (tabId === "scheduled") return jobStatus === "scheduled" || jobStatus === "late";
  if (tabId === "in_progress") return (JOB_ONSITE_PROGRESS_STATUSES as readonly string[]).includes(jobStatus);
  if (tabId === "final_check") return jobStatus === "final_check" || jobStatus === "need_attention";
  if (tabId === "awaiting_payment") return jobStatus === "awaiting_payment";
  if (tabId === "completed") return jobStatus === "completed";
  if (tabId === "cancelled") return jobStatus === "cancelled";
  if (tabId === "deleted") return false;
  return jobStatus === tabId;
}

/**
 * Tab grouping for Jobs Management (list, kanban, KPIs): `scheduled` / `late` / on-site phases
 * without a partner are treated as **Unassigned**, not Scheduled / In progress.
 */
export function jobRowMatchesJobsManagementTab(
  job: Pick<Job, "status" | "partner_id" | "partner_ids">,
  tabId: string,
): boolean {
  if (tabId === "all") {
    return jobMatchesJobsManagementTab(job.status, tabId);
  }
  if (jobIsBookedPipelineWithoutPartner(job)) {
    return tabId === "unassigned";
  }
  return jobMatchesJobsManagementTab(job.status, tabId);
}

/** Schedule calendar: same pipeline as Jobs tabs Unassigned, Scheduled, In progress, Final checks (excludes awaiting payment, completed, cancelled, etc.). */
export function jobVisibleOnSchedule(job: Pick<Job, "status" | "partner_id" | "partner_ids">): boolean {
  return (
    jobRowMatchesJobsManagementTab(job, "unassigned") ||
    jobRowMatchesJobsManagementTab(job, "scheduled") ||
    jobRowMatchesJobsManagementTab(job, "in_progress") ||
    jobRowMatchesJobsManagementTab(job, "final_check")
  );
}

export async function markLateJobs(): Promise<void> {
  const supabase = getSupabase();
  const nowIso = new Date().toISOString();
  const today = new Date().toISOString().slice(0, 10);
  await Promise.all([
    // Drop `late` when the booking was moved forward — slot no longer in the past.
    supabase
      .from("jobs")
      .update({ status: "scheduled" })
      .eq("status", "late")
      .not("scheduled_end_at", "is", null)
      .gte("scheduled_end_at", nowIso),
    supabase
      .from("jobs")
      .update({ status: "scheduled" })
      .eq("status", "late")
      .is("scheduled_end_at", null)
      .not("scheduled_start_at", "is", null)
      .gte("scheduled_start_at", nowIso),
    supabase
      .from("jobs")
      .update({ status: "scheduled" })
      .eq("status", "late")
      .is("scheduled_start_at", null)
      .not("scheduled_date", "is", null)
      .gte("scheduled_date", today),
  ]);
  await Promise.all([
    // Arrival window set: late only after the window ends (e.g. after 10:00 for 09:00–10:00).
    supabase
      .from("jobs")
      .update({ status: "late" })
      .eq("status", "scheduled")
      .not("scheduled_end_at", "is", null)
      .lt("scheduled_end_at", nowIso),
    // Start time only (no end): late after scheduled start (legacy behaviour).
    supabase
      .from("jobs")
      .update({ status: "late" })
      .eq("status", "scheduled")
      .is("scheduled_end_at", null)
      .not("scheduled_start_at", "is", null)
      .lt("scheduled_start_at", nowIso),
    // Date-only jobs: late when the calendar day is in the past.
    supabase
      .from("jobs")
      .update({ status: "late" })
      .eq("status", "scheduled")
      .is("scheduled_start_at", null)
      .lt("scheduled_date", today),
  ]);
  lastMarkLateAt = Date.now();
}

function jobMatchesSearchKeyword(j: Job, search: string): boolean {
  const s = search.trim().toLowerCase();
  return [j.reference, j.title, j.client_name, j.partner_name, j.property_address].some((f) =>
    String(f ?? "").toLowerCase().includes(s),
  );
}

function compareJobsForSort(a: Job, b: Job, sortKey: string, sortDir: SortDirection): number {
  const av = (a as unknown as Record<string, unknown>)[sortKey];
  const bv = (b as unknown as Record<string, unknown>)[sortKey];
  const sa = av != null ? String(av) : "";
  const sb = bv != null ? String(bv) : "";
  const cmp = sa < sb ? -1 : sa > sb ? 1 : 0;
  return sortDir === "asc" ? cmp : -cmp;
}

async function listJobsWithSchedulePeriodOverlap(params: ListParams): Promise<ListResult<Job>> {
  const range = params.scheduleRange!;
  let statusIn: string[];
  if (params.statusIn && params.statusIn.length > 0) statusIn = [...params.statusIn];
  else if (params.status === "in_progress") statusIn = [...JOB_ONSITE_PROGRESS_STATUSES];
  else if (params.status === "scheduled") statusIn = ["scheduled", "late"];
  else if (params.status === "unassigned") {
    statusIn = [
      "unassigned",
      "auto_assigning",
      "scheduled",
      "late",
      ...JOB_ONSITE_PROGRESS_STATUSES,
    ];
  } else if (!params.status || params.status === "all") statusIn = [...JOB_LIST_ALL_TAB_STATUSES];
  else statusIn = [params.status];

  const all = await loadAllJobsForPeriodOverlap(statusIn, range);
  const search = params.search?.trim();
  let filtered = search ? all.filter((j) => jobMatchesSearchKeyword(j, search)) : all;
  const tabId = params.status;
  if (tabId && tabId !== "all") {
    filtered = filtered.filter((j) => jobRowMatchesJobsManagementTab(j, tabId));
  }
  const sortKey = params.sortBy ?? "created_at";
  const sortDir = (params.sortDir ?? "desc") as SortDirection;
  const rows = [...filtered].sort((a, b) => compareJobsForSort(a, b, sortKey, sortDir));

  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 10;
  const start = (page - 1) * pageSize;
  const data = rows.slice(start, start + pageSize);
  const count = rows.length;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  return { data, count, page, pageSize, totalPages };
}

export async function listJobs(params: ListParams): Promise<ListResult<Job>> {
  const shouldRunMarkLate =
    (params.page ?? 1) <= 1 &&
    !params.search &&
    !params.dateFrom &&
    !params.dateTo &&
    !params.scheduleRange &&
    params.status !== "archived" &&
    params.status !== "deleted" &&
    (params.status === "scheduled" || params.status === "all" || !params.status);
  if (shouldRunMarkLate && Date.now() - lastMarkLateAt > MARK_LATE_INTERVAL_MS) {
    void markLateJobs(); // fire-and-forget: don't block the list query
  }

  if (params.status === "archived" || params.status === "deleted") {
    const { status: _st, scheduleRange: _sched, ...rest } = params;
    return queryList<Job>(
      "jobs",
      {
        ...rest,
        archivedOnly: true,
        status: "deleted",
        sortBy: rest.sortBy ?? "deleted_at",
        sortDir: rest.sortDir ?? "desc",
      },
      {
        searchColumns: ["reference", "title", "client_name", "partner_name", "property_address"],
        defaultSort: "deleted_at",
      },
    );
  }

  if (params.scheduleRange) {
    return listJobsWithSchedulePeriodOverlap(params);
  }

  if (params.statusIn && params.statusIn.length > 0) {
    return queryList<Job>("jobs", params, {
      searchColumns: ["reference", "title", "client_name", "partner_name", "property_address"],
      defaultSort: "created_at",
    });
  }

  if (params.status === "in_progress") {
    const { status: _omit, ...rest } = params;
    return queryList<Job>(
      "jobs",
      {
        ...rest,
        statusIn: [...JOB_ONSITE_PROGRESS_STATUSES],
        jobsRequirePartnerSet: true,
      },
      {
        searchColumns: ["reference", "title", "client_name", "partner_name", "property_address"],
        defaultSort: "created_at",
      }
    );
  }
  if (params.status === "scheduled") {
    const { status: _omit, ...rest } = params;
    return queryList<Job>(
      "jobs",
      {
        ...rest,
        statusIn: ["scheduled", "late"],
        jobsRequirePartnerSet: true,
      },
      {
        searchColumns: ["reference", "title", "client_name", "partner_name", "property_address"],
        defaultSort: "created_at",
      }
    );
  }
  if (params.status === "unassigned") {
    const { status: _omit, ...rest } = params;
    return queryList<Job>(
      "jobs",
      {
        ...rest,
        jobsUnassignedPipelineTab: true,
      },
      {
        searchColumns: ["reference", "title", "client_name", "partner_name", "property_address"],
        defaultSort: "created_at",
      }
    );
  }

  if (!params.status || params.status === "all") {
    const { status: _omit, ...rest } = params;
    return queryList<Job>(
      "jobs",
      { ...rest, statusIn: [...JOB_LIST_ALL_TAB_STATUSES] },
      {
        searchColumns: ["reference", "title", "client_name", "partner_name", "property_address"],
        defaultSort: "created_at",
      },
    );
  }

  return queryList<Job>("jobs", params, {
    searchColumns: ["reference", "title", "client_name", "partner_name", "property_address"],
    defaultSort: "created_at",
  });
}

export async function getJob(id: string): Promise<Job | null> {
  if (!id?.trim()) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id.trim())
    .maybeSingle();
  if (error) return null;
  return data as Job | null;
}

export async function getJobByQuoteId(quoteId: string): Promise<Job | null> {
  if (isLegacyJobSchema()) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("quote_id", quoteId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data as Job | null;
}

export async function createJob(
  input: Omit<Job, "id" | "reference" | "created_at" | "updated_at">
): Promise<Job> {
  const supabase = getSupabase();
  const inputFromQuotePre = (() => {
    const qid = (input as { quote_id?: string | null }).quote_id;
    return qid != null && String(qid).trim() !== "";
  })();
  const billablePre = Number(input.client_price ?? 0) + Number(input.extras_amount ?? 0);
  const scheduledPre = Number(input.customer_deposit ?? 0) + Number(input.customer_final_payment ?? 0);
  const invoiceTotalPre = Math.max(0, Math.max(billablePre, scheduledPre));
  const needInvoice = invoiceTotalPre > 0.01 && !inputFromQuotePre;
  /** Geocode in parallel with ref RPCs — same critical path, independent I/O. */
  const [jobRefRes, invRefRes, coords] = await Promise.all([
    supabase.rpc("next_job_ref"),
    needInvoice
      ? supabase.rpc("next_invoice_ref")
      : Promise.resolve({ data: null as string | null, error: null }),
    resolveJobGeocode(input.property_address),
  ]);
  if (jobRefRes.error) throw jobRefRes.error;
  const ref = jobRefRes.data as string;
  let invoiceRefPre: string | undefined;
  if (needInvoice) {
    if (invRefRes.error) throw invRefRes.error;
    const ir = invRefRes.data as string | null;
    if (ir == null || String(ir).trim() === "") {
      throw new Error("Could not generate invoice reference (next_invoice_ref).");
    }
    invoiceRefPre = ir;
  }

  const baseRow = { ...input, reference: ref } as Record<string, unknown>;
  /** No partner → stay in Unassigned (Work Request + Auto assign keeps `auto_assigning`). */
  if (!jobHasPartnerSet(input as Job) && (input as Job).status !== "auto_assigning") {
    baseRow.status = "unassigned";
  }
  /** Partner set → leave the auto-assign queue (manual pick or post-create assign). */
  if (jobHasPartnerSet(input as Job) && (input as Job).status === "auto_assigning") {
    baseRow.status = "scheduled";
  }
  if (coords) {
    baseRow.latitude = coords.latitude;
    baseRow.longitude = coords.longitude;
  }
  const row = prepareJobRowForInsert(baseRow);
  let { data, error } = await supabase.from("jobs").insert(row).select().single();
  if (error && isPostgrestWriteRetryableError(error)) {
    const retry = await supabase.from("jobs").insert(applyJobDbCompat(baseRow)).select().single();
    data = retry.data;
    error = retry.error;
  }
  if (error) throw error;
  let job = data as Job;

  /** Quote → job flow creates its own invoice after insert; `quote_id` may be stripped on legacy DB retry — trust input too. */
  const inputFromQuote = (() => {
    const qid = (input as { quote_id?: string | null }).quote_id;
    return qid != null && String(qid).trim() !== "";
  })();
  const fromQuote =
    inputFromQuote || Boolean((job as { quote_id?: string | null }).quote_id?.toString().trim());
  const billableTotal = Number(job.client_price ?? 0) + Number(job.extras_amount ?? 0);
  const scheduledTotal = Number(job.customer_deposit ?? 0) + Number(job.customer_final_payment ?? 0);
  const invoiceTotal = Math.max(0, Math.max(billableTotal, scheduledTotal));
  if (invoiceTotal > 0.01 && !job.invoice_id && !fromQuote) {
    try {
      const dueDateStr = await getInvoiceDueDateIsoForClient(job.client_id ?? null);
      const inv = await createInvoice(
        {
          client_name: job.client_name,
          job_reference: job.reference,
          amount: invoiceTotal,
          status: "pending",
          due_date: dueDateStr,
          invoice_kind: "final",
        },
        invoiceRefPre ? { reference: invoiceRefPre } : undefined,
      );
      await supabase.from("jobs").update({ invoice_id: inv.id }).eq("id", job.id);
      job = { ...job, invoice_id: inv.id };
    } catch {
      /* invoice can be added manually in Finance */
    }
  }

  void syncSelfBillAfterJobChange(job).catch(() => {});
  return job;
}

const JOB_SCHEDULE_PATCH_KEYS = [
  "scheduled_date",
  "scheduled_start_at",
  "scheduled_end_at",
  "scheduled_finish_date",
] as const;

function jobPatchTouchesSchedule(patch: Record<string, unknown>): boolean {
  return JOB_SCHEDULE_PATCH_KEYS.some((k) => Object.prototype.hasOwnProperty.call(patch, k));
}

/** Slim read for `updateJob` gates — avoids loading the full jobs row before PATCH. */
const JOB_UPDATE_GATE_COLUMNS =
  "status,scheduled_date,scheduled_start_at,scheduled_end_at,scheduled_finish_date";

/** Same gates without `scheduled_finish_date` (migration 064) for DBs where PostgREST returns 400. */
const JOB_UPDATE_GATE_COLUMNS_NO_FINISH =
  "status,scheduled_date,scheduled_start_at,scheduled_end_at";

async function fetchJobGatesForUpdate(id: string): Promise<Pick<
  Job,
  "status" | "scheduled_date" | "scheduled_start_at" | "scheduled_end_at" | "scheduled_finish_date"
> | null> {
  if (!id?.trim()) return null;
  const supabase = getSupabase();
  const jid = id.trim();

  let { data, error } = await supabase.from("jobs").select(JOB_UPDATE_GATE_COLUMNS).eq("id", jid).maybeSingle();

  if (error && isSupabaseMissingColumnError(error)) {
    ({ data, error } = await supabase.from("jobs").select(JOB_UPDATE_GATE_COLUMNS_NO_FINISH).eq("id", jid).maybeSingle());
  }

  if (error || !data) return null;
  return data as Pick<
    Job,
    "status" | "scheduled_date" | "scheduled_start_at" | "scheduled_end_at" | "scheduled_finish_date"
  >;
}

export type UpdateJobOptions = {
  /** Skip weekly self-bill recompute (call `syncSelfBillAfterJobChange` once after a batch of updates). */
  skipSelfBillSync?: boolean;
};

/** Use `null` (not `undefined`) on nullable columns you want to clear — `undefined` keys are omitted from the PATCH. */
export async function updateJob(
  id: string,
  input: Partial<Job>,
  options?: UpdateJobOptions
): Promise<Job> {
  if (!id?.trim()) throw new Error("Invalid job id");
  const trimmedId = id.trim();
  const supabase = getSupabase();
  const beforeGates = await fetchJobGatesForUpdate(trimmedId);
  if (!beforeGates) throw new Error("Job not found");

  const basePatch = input as Record<string, unknown>;
  /** Reschedule clears `late`: late = missed start on the previous slot; new date/time is a new booking. */
  const effectivePatch: Record<string, unknown> = { ...basePatch };
  if (beforeGates.status === "late" && jobPatchTouchesSchedule(basePatch)) {
    effectivePatch.status = "scheduled";
  }
  const partnerFieldsTouched =
    "partner_id" in basePatch || "partner_ids" in basePatch || "partner_name" in basePatch;
  if (partnerFieldsTouched) {
    const { data: partnerRow } = await supabase
      .from("jobs")
      .select("partner_id, partner_ids")
      .eq("id", trimmedId)
      .maybeSingle();
    const mergedPartner = {
      partner_id:
        basePatch.partner_id !== undefined ? basePatch.partner_id : partnerRow?.partner_id,
      partner_ids:
        basePatch.partner_ids !== undefined ? basePatch.partner_ids : partnerRow?.partner_ids,
    };
    if (
      !jobHasPartnerSet(mergedPartner as Job) &&
      JOB_STATUSES_UNASSIGN_WHEN_PARTNER_CLEARED.includes(beforeGates.status)
    ) {
      effectivePatch.status = "unassigned";
    }
  }
  const patch = prepareJobRowForUpdate(effectivePatch);

  if (Object.prototype.hasOwnProperty.call(basePatch, "property_address")) {
    const addr =
      typeof basePatch.property_address === "string" ? basePatch.property_address.trim() : "";
    if (addr.length >= 3) {
      const coords = await resolveJobGeocode(addr);
      if (coords) {
        patch.latitude = coords.latitude;
        patch.longitude = coords.longitude;
      }
    }
  }

  /**
   * Return full row from PATCH (array select — no `.single()`) to skip a follow-up `getJob`.
   * Plural JSON avoids 406 when zero rows; we check `length` instead.
   */
  async function runUpdateReturning(row: Record<string, unknown>) {
    return supabase.from("jobs").update(row).eq("id", trimmedId).select("*");
  }

  let { data: rows, error } = await runUpdateReturning(patch);
  if (error && isPostgrestWriteRetryableError(error)) {
    /** Use full `patch` (incl. geocoded lat/lng), not `effectivePatch` — compat strip must not drop coords. */
    const retry = await runUpdateReturning(applyJobDbCompat({ ...patch }));
    rows = retry.data;
    error = retry.error;
  }
  if (error) throw error;
  if (!rows?.length) {
    throw new Error("Job update did not affect any row (check permissions or job id).");
  }

  const row = rows[0] as Job;
  if (!row.id?.toString().trim()) {
    throw new Error("Job update returned a row without id — refresh the page.");
  }
  if (!options?.skipSelfBillSync) {
    await syncSelfBillAfterJobChange(row);
  }
  if (row.status === "cancelled") {
    try {
      await cancelOpenInvoicesForJobCancellation({
        jobReference: row.reference,
        cancellationReason:
          row.cancellation_reason?.trim() ||
          row.partner_cancellation_reason?.trim() ||
          "Job cancelled.",
        primaryInvoiceId: row.invoice_id,
      });
    } catch (e) {
      console.error("cancelOpenInvoicesForJobCancellation:", e);
    }
  }
  return row;
}
