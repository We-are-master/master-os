import { getSupabase, queryList, applyJobsScheduleRangeToQuery, type ListParams, type ListResult } from "./base";
import type { Job } from "@/types/database";
import { createInvoice } from "./invoices";
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
import { jobHasPartnerSet } from "@/lib/job-partner-assign";

/** Slim rows for Jobs Management KPIs (avg ticket, avg margin); loaded in chunks to avoid pagination bias. */
export type JobFinancialKpiRow = Pick<
  Job,
  "status" | "client_price" | "extras_amount" | "partner_cost" | "materials_cost"
>;

export async function fetchAllJobsFinancialKpiRows(
  scheduleRange?: { from: string; to: string } | null
): Promise<JobFinancialKpiRow[]> {
  const supabase = getSupabase();
  const chunk = 1000;
  let columns = "status,client_price,extras_amount,partner_cost,materials_cost";
  const all: JobFinancialKpiRow[] = [];
  for (let from = 0; ; from += chunk) {
    const run = async (cols: string) => {
      let q = supabase.from("jobs").select(cols).is("deleted_at", null);
      if (scheduleRange) q = applyJobsScheduleRangeToQuery(q, scheduleRange);
      return q.order("created_at", { ascending: false }).range(from, from + chunk - 1);
    };
    let { data, error } = await run(columns);
    if (error && isPostgrestWriteRetryableError(error) && columns.includes("extras_amount")) {
      columns = "status,client_price,partner_cost,materials_cost";
      ({ data, error } = await run(columns));
    }
    if (error) throw error;
    const batch = (data ?? []) as unknown as JobFinancialKpiRow[];
    all.push(...batch);
    if (batch.length < chunk) break;
  }
  return all;
}

// Throttle: mark-late should not run on every jobs list request.
let lastMarkLateAt = 0;
const MARK_LATE_INTERVAL_MS = 30 * 60 * 1000;

export async function markLateJobs(): Promise<void> {
  const supabase = getSupabase();
  const nowIso = new Date().toISOString();
  const today = new Date().toISOString().slice(0, 10);
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

export async function listJobs(params: ListParams): Promise<ListResult<Job>> {
  const shouldRunMarkLate =
    (params.page ?? 1) <= 1 &&
    !params.search &&
    !params.dateFrom &&
    !params.dateTo &&
    !params.scheduleRange &&
    (params.status === "scheduled" || params.status === "all" || !params.status);
  if (shouldRunMarkLate && Date.now() - lastMarkLateAt > MARK_LATE_INTERVAL_MS) {
    void markLateJobs(); // fire-and-forget: don't block the list query
  }

  if (params.status === "in_progress") {
    const { status: _omit, ...rest } = params;
    return queryList<Job>(
      "jobs",
      { ...rest, statusIn: [...JOB_ONSITE_PROGRESS_STATUSES] },
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
      { ...rest, statusIn: ["scheduled", "late"] },
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
      { ...rest, statusIn: ["unassigned", "auto_assigning"] },
      {
        searchColumns: ["reference", "title", "client_name", "partner_name", "property_address"],
        defaultSort: "created_at",
      }
    );
  }
  return queryList<Job>("jobs", params, {
    searchColumns: ["reference", "title", "client_name", "partner_name", "property_address"],
    defaultSort: "created_at",
  });
}

export async function getJob(id: string): Promise<Job | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data as Job;
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
  const [jobRefRes, invRefRes] = await Promise.all([
    supabase.rpc("next_job_ref"),
    needInvoice
      ? supabase.rpc("next_invoice_ref")
      : Promise.resolve({ data: null as string | null, error: null }),
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

/** Use `null` (not `undefined`) on nullable columns you want to clear — `undefined` keys are omitted from the PATCH. */
export async function updateJob(
  id: string,
  input: Partial<Job>
): Promise<Job> {
  const supabase = getSupabase();
  const basePatch = input as Record<string, unknown>;
  const patch = prepareJobRowForUpdate(basePatch);

  /**
   * Avoid `.select().single()` on PATCH: PostgREST returns **406 Not Acceptable** when the
   * `Accept: application/vnd.pgrst.object+json` singular response gets 0 rows (RLS, or empty RETURNING).
   * We verify with a plural `.select("id")`, then reload the full row via `getJob`.
   */
  async function runUpdate(row: Record<string, unknown>) {
    return supabase.from("jobs").update(row).eq("id", id).select("id");
  }

  let { data: idRows, error } = await runUpdate(patch);
  if (error && isPostgrestWriteRetryableError(error)) {
    const retry = await runUpdate(applyJobDbCompat({ ...basePatch }));
    idRows = retry.data;
    error = retry.error;
  }
  if (error) throw error;
  if (!idRows?.length) {
    throw new Error("Job update did not affect any row (check permissions or job id).");
  }

  const row = await getJob(id);
  if (!row) throw new Error("Job not found after update");
  await syncSelfBillAfterJobChange(row);
  return row;
}
