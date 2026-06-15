import { getSupabase } from "@/services/base";
import { fetchAllActiveInvoices } from "@/lib/billing-invoice-list-data";
import { addDaysYmd, type YmdBounds } from "@/lib/billing-standalone-period";
import {
  isSupabaseMissingColumnError,
  isSupabaseSelfBillPaymentPlanSchemaMissing,
} from "@/lib/supabase-schema-compat";
import type { Bill, Invoice, InvoicePaymentInstallment, SelfBill, SelfBillPaymentInstallment } from "@/types/database";

const PAGE_SIZE = 500;
const MAX_PAGES = 40;
/** Open items older than this (before period start) are omitted unless bounds is null (All). */
const OPEN_ITEM_LOOKBACK_DAYS = 180;

function openItemsRecencyFrom(bounds: YmdBounds): string {
  return addDaysYmd(bounds.from, -OPEN_ITEM_LOOKBACK_DAYS);
}

const CLOSED_INVOICE_STATUSES = ["paid", "cancelled"] as const;
const CLOSED_INVOICE_LIST = `(${CLOSED_INVOICE_STATUSES.map((s) => `"${s}"`).join(",")})`;

const CLOSED_SELF_BILL_STATUSES = [
  "paid",
  "rejected",
  "payout_cancelled",
  "payout_archived",
  "payout_lost",
] as const;
const CLOSED_SELF_BILL_LIST = `(${CLOSED_SELF_BILL_STATUSES.map((s) => `"${s}"`).join(",")})`;

const CLOSED_BILL_STATUSES = ["paid", "rejected"] as const;
const CLOSED_BILL_LIST = `(${CLOSED_BILL_STATUSES.map((s) => `"${s}"`).join(",")})`;

function invoiceQueryBase() {
  return getSupabase().from("invoices").select("*").is("deleted_at", null);
}

function selfBillQueryBase() {
  return getSupabase().from("self_bills").select("*");
}

type InvoiceQuery = ReturnType<typeof invoiceQueryBase>;
type SelfBillQuery = ReturnType<typeof selfBillQueryBase>;

async function fetchInvoiceQueryPages(apply: (q: InvoiceQuery) => InvoiceQuery): Promise<Invoice[]> {
  const acc: Invoice[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await apply(invoiceQueryBase())
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Invoice[];
    if (rows.length === 0) break;
    acc.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return acc;
}

/** Skip optional invoice slices when a column is not in the hosted schema yet. */
async function fetchInvoiceQueryPagesOptional(
  apply: (q: InvoiceQuery) => InvoiceQuery,
  label: string,
): Promise<Invoice[]> {
  try {
    return await fetchInvoiceQueryPages(apply);
  } catch (e) {
    if (isSupabaseMissingColumnError(e)) {
      console.warn(`billing invoices: skipped ${label} — apply migration for missing column`);
      return [];
    }
    throw e;
  }
}

export function mergeInvoicesById(rows: Invoice[]): Invoice[] {
  const byId = new Map<string, Invoice>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()].sort(
    (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
  );
}

/**
 * Scoped billing load: open invoices + rows touching the period (due or paid).
 * When bounds is null (All), falls back to full history pagination.
 */
export async function fetchInvoicesForBilling(bounds: YmdBounds | null): Promise<Invoice[]> {
  if (!bounds) return fetchAllActiveInvoices();

  const openFrom = openItemsRecencyFrom(bounds);

  const [openRows, dueRows, paidByDueRows, paidByPaidDateRows, paidByStripeRows] = await Promise.all([
    fetchInvoiceQueryPages((q) => q.not("status", "in", CLOSED_INVOICE_LIST).gte("due_date", openFrom)),
    fetchInvoiceQueryPages((q) => q.gte("due_date", bounds.from).lte("due_date", bounds.to)),
    fetchInvoiceQueryPages((q) =>
      q.eq("status", "paid").gte("paid_date", bounds.from).lte("paid_date", bounds.to),
    ),
    fetchInvoiceQueryPagesOptional(
      (q) =>
        q.eq("status", "paid").gte("last_payment_date", bounds.from).lte("last_payment_date", bounds.to),
      "paid by last_payment_date",
    ),
    fetchInvoiceQueryPagesOptional(
      (q) =>
        q
          .eq("status", "paid")
          .gte("stripe_paid_at", `${bounds.from}T00:00:00`)
          .lte("stripe_paid_at", `${bounds.to}T23:59:59`),
      "paid by stripe_paid_at",
    ),
  ]);

  return mergeInvoicesById([
    ...openRows,
    ...dueRows,
    ...paidByDueRows,
    ...paidByPaidDateRows,
    ...paidByStripeRows,
  ]);
}

async function fetchSelfBillQueryPages(apply: (q: SelfBillQuery) => SelfBillQuery): Promise<SelfBill[]> {
  const acc: SelfBill[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await apply(selfBillQueryBase())
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as SelfBill[];
    if (rows.length === 0) break;
    acc.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return acc;
}

async function fetchSelfBillQueryPagesOptional(
  apply: (q: SelfBillQuery) => SelfBillQuery,
  label: string,
): Promise<SelfBill[]> {
  try {
    return await fetchSelfBillQueryPages(apply);
  } catch (e) {
    if (isSupabaseMissingColumnError(e)) {
      console.warn(`billing self-bills: skipped ${label} — apply migration for missing column`);
      return [];
    }
    throw e;
  }
}

const INTERNAL_LIVE_STATUSES = ["accumulating", "draft", "needs_attention"] as const;

async function fetchSelfBillsWithDueDateFallback(
  applyWithDueDate: (q: SelfBillQuery) => SelfBillQuery,
  applyWithWeekEnd: (q: SelfBillQuery) => SelfBillQuery,
  label: string,
): Promise<SelfBill[]> {
  try {
    return await fetchSelfBillQueryPages(applyWithDueDate);
  } catch (e) {
    if (!isSupabaseMissingColumnError(e, "due_date")) throw e;
    console.warn(`billing self-bills: ${label} using week_end fallback — apply migration 146 for due_date`);
    return fetchSelfBillQueryPages(applyWithWeekEnd);
  }
}

async function fetchInternalLiveSelfBills(bounds: YmdBounds): Promise<SelfBill[]> {
  return fetchSelfBillsWithDueDateFallback(
    (q) =>
      q
        .eq("bill_origin", "internal")
        .in("status", [...INTERNAL_LIVE_STATUSES])
        .gte("due_date", bounds.from),
    (q) =>
      q
        .eq("bill_origin", "internal")
        .in("status", [...INTERNAL_LIVE_STATUSES])
        .lte("week_start", bounds.to)
        .gte("week_end", bounds.from),
    "internal live by due_date",
  ).catch(async (e) => {
    if (!isSupabaseMissingColumnError(e, "bill_origin")) throw e;
    return fetchSelfBillQueryPages((q) =>
      q
        .eq("bill_origin", "internal")
        .in("status", [...INTERNAL_LIVE_STATUSES])
        .lte("week_start", bounds.to)
        .gte("week_end", bounds.from),
    );
  });
}

export function mergeSelfBillsById(rows: SelfBill[]): SelfBill[] {
  const byId = new Map<string, SelfBill>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()].sort(
    (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
  );
}

/** Open self-bills + work weeks overlapping bounds. Full history when bounds is null. */
export async function fetchSelfBillsForBilling(bounds: YmdBounds | null): Promise<SelfBill[]> {
  if (!bounds) {
    const supabase = getSupabase();
    const acc: SelfBill[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const from = page * PAGE_SIZE;
      const { data, error } = await supabase
        .from("self_bills")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      const rows = (data ?? []) as SelfBill[];
      if (rows.length === 0) break;
      acc.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
    return acc;
  }

  const openFrom = openItemsRecencyFrom(bounds);

  const [openRows, overlapRows, weekEndRows, dueDateRows, internalAccumulatingRows] = await Promise.all([
    fetchSelfBillsWithDueDateFallback(
      (q) => q.not("status", "in", CLOSED_SELF_BILL_LIST).gte("due_date", openFrom),
      (q) => q.not("status", "in", CLOSED_SELF_BILL_LIST).gte("week_end", openFrom),
      "open items by due_date",
    ),
    fetchSelfBillQueryPages((q) => q.lte("week_start", bounds.to).gte("week_end", bounds.from)),
    fetchSelfBillQueryPages((q) => q.gte("week_end", bounds.from).lte("week_end", bounds.to)),
    fetchSelfBillQueryPagesOptional(
      (q) => q.gte("due_date", bounds.from).lte("due_date", bounds.to),
      "due_date in period",
    ),
    fetchInternalLiveSelfBills(bounds),
  ]);

  return mergeSelfBillsById([
    ...openRows,
    ...overlapRows,
    ...weekEndRows,
    ...dueDateRows,
    ...internalAccumulatingRows,
  ]);
}

function billQueryBase() {
  return getSupabase().from("bills").select("*");
}

type BillQuery = ReturnType<typeof billQueryBase>;

async function fetchBillQueryPages(apply: (q: BillQuery) => BillQuery): Promise<Bill[]> {
  const acc: Bill[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await apply(billQueryBase())
      .order("due_date", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Bill[];
    if (rows.length === 0) break;
    acc.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return acc;
}

async function fetchOpenBillQueryPages(apply: (q: BillQuery) => BillQuery): Promise<Bill[]> {
  try {
    return await fetchBillQueryPages((q) =>
      apply(q.not("status", "in", CLOSED_BILL_LIST).is("archived_at", null)),
    );
  } catch (e) {
    if (!isSupabaseMissingColumnError(e, "archived_at")) throw e;
    console.warn("billing bills: archived_at missing — fetching without archive filter");
    return fetchBillQueryPages((q) => apply(q.not("status", "in", CLOSED_BILL_LIST)));
  }
}

export function mergeBillsById(rows: Bill[]): Bill[] {
  const byId = new Map<string, Bill>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
}

/** Open bills (not paid/rejected/archived) with due_date in or near the billing window. */
export async function fetchBillsForBilling(bounds: YmdBounds | null): Promise<Bill[]> {
  if (!bounds) {
    return fetchOpenBillQueryPages((q) => q);
  }

  const openFrom = openItemsRecencyFrom(bounds);

  const [openRows, dueRows] = await Promise.all([
    fetchOpenBillQueryPages((q) => q.gte("due_date", openFrom)),
    fetchOpenBillQueryPages((q) => q.gte("due_date", bounds.from).lte("due_date", bounds.to)),
  ]);

  return mergeBillsById([...openRows, ...dueRows]);
}

/** Partner payout plan installments for open self-bills (mig 235). */
export async function fetchSelfBillInstallmentsForBilling(
  selfBills: SelfBill[],
): Promise<Record<string, SelfBillPaymentInstallment[]>> {
  const ids = selfBills.map((sb) => sb.id).filter(Boolean);
  if (ids.length === 0) return {};

  const out: Record<string, SelfBillPaymentInstallment[]> = {};
  const chunk = 200;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const { data, error } = await getSupabase()
      .from("self_bill_payment_installments")
      .select("*")
      .in("self_bill_id", slice)
      .order("sequence", { ascending: true });
    if (error) {
      if (isSupabaseSelfBillPaymentPlanSchemaMissing(error)) {
        console.warn(
          "billing: self_bill_payment_installments unavailable — apply migration 235 and NOTIFY pgrst, 'reload schema';",
        );
        return {};
      }
      throw error;
    }
    for (const row of (data ?? []) as SelfBillPaymentInstallment[]) {
      const list = out[row.self_bill_id] ?? [];
      list.push(row);
      out[row.self_bill_id] = list;
    }
  }
  return out;
}

/** Payment plan installments for open invoices (mig 234). */
export async function fetchInstallmentsForBilling(
  invoices: Invoice[],
): Promise<Record<string, InvoicePaymentInstallment[]>> {
  const ids = invoices
    .filter((inv) => inv.payment_plan_active || inv.status !== "paid")
    .map((inv) => inv.id)
    .filter(Boolean);
  if (ids.length === 0) return {};

  const out: Record<string, InvoicePaymentInstallment[]> = {};
  const chunk = 200;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const { data, error } = await getSupabase()
      .from("invoice_payment_installments")
      .select("*")
      .in("invoice_id", slice)
      .order("sequence", { ascending: true });
    if (error) {
      if (isSupabaseMissingColumnError(error)) return {};
      throw error;
    }
    for (const row of (data ?? []) as InvoicePaymentInstallment[]) {
      const list = out[row.invoice_id] ?? [];
      list.push(row);
      out[row.invoice_id] = list;
    }
  }
  return out;
}

export type PayrollRunwayRow = {
  id: string;
  label: string;
  amount: number;
  dueYmd: string;
};

export type PipelineJobRunwayRow = {
  id: string;
  reference: string;
  client_id: string | null;
  client_name: string | null;
  client_price: number;
  extras_amount: number | null;
  scheduled_date: string | null;
  scheduled_start_at: string | null;
  status: string;
};

/** Pending payroll lines with due_date in or near the billing runway window. */
export async function fetchPayrollForBilling(bounds: YmdBounds | null): Promise<PayrollRunwayRow[]> {
  const supabase = getSupabase();
  const payrollSelectFull = "id, payee_name, description, amount, due_date, status";
  const payrollSelectBase = "id, description, amount, due_date, status";

  let query = supabase
    .from("payroll_internal_costs")
    .select(payrollSelectFull)
    .eq("status", "pending")
    .not("due_date", "is", null)
    .gt("amount", 0);

  if (bounds) {
    const from = openItemsRecencyFrom(bounds);
    query = query.gte("due_date", from).lte("due_date", bounds.to);
  }

  let { data, error } = await query.order("due_date", { ascending: true });
  if (error) {
    const retryQ = supabase
      .from("payroll_internal_costs")
      .select(payrollSelectBase)
      .eq("status", "pending")
      .not("due_date", "is", null)
      .gt("amount", 0);
    const bounded =
      bounds != null
        ? retryQ.gte("due_date", openItemsRecencyFrom(bounds)).lte("due_date", bounds.to)
        : retryQ;
    const retry = await bounded.order("due_date", { ascending: true });
    if (retry.error) throw retry.error;
    data = retry.data as typeof data;
  }

  const rows: PayrollRunwayRow[] = [];
  for (const row of data ?? []) {
    const r = row as {
      id?: string;
      payee_name?: string | null;
      description?: string | null;
      amount?: number;
      due_date?: string | null;
    };
    const id = r.id?.trim();
    const dueYmd = r.due_date?.trim().slice(0, 10) ?? "";
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(dueYmd)) continue;
    const amount = Math.round(Number(r.amount ?? 0) * 100) / 100;
    if (amount <= 0.02) continue;
    rows.push({
      id,
      label: r.payee_name?.trim() || r.description?.trim() || "Payroll",
      amount,
      dueYmd,
    });
  }
  return rows;
}

const PIPELINE_JOB_STATUSES = [
  "unassigned",
  "auto_assigning",
  "scheduled",
  "late",
  "in_progress",
  "final_check",
  "awaiting_payment",
  "need_attention",
] as const;

const PIPELINE_JOB_SELECT =
  "id, reference, client_id, client_name, client_price, extras_amount, scheduled_date, scheduled_start_at, status, invoice_id";

/** Pipeline jobs without a linked invoice — revenue projected by expected due date. */
export async function fetchPipelineJobsForRunway(bounds: YmdBounds | null): Promise<PipelineJobRunwayRow[]> {
  const supabase = getSupabase();

  let query = supabase
    .from("jobs")
    .select(PIPELINE_JOB_SELECT)
    .in("status", [...PIPELINE_JOB_STATUSES])
    .is("invoice_id", null)
    .is("deleted_at", null);

  if (bounds) {
    const from = openItemsRecencyFrom(bounds);
    query = query.or(`scheduled_date.gte.${from},scheduled_start_at.gte.${from}T00:00:00`);
  }

  const { data, error } = await query.limit(2000);
  if (error) {
    if (isSupabaseMissingColumnError(error, "invoice_id")) {
      const fallback = await supabase
        .from("jobs")
        .select(
          "id, reference, client_id, client_name, client_price, extras_amount, scheduled_date, scheduled_start_at, status",
        )
        .in("status", [...PIPELINE_JOB_STATUSES])
        .is("deleted_at", null)
        .limit(2000);
      if (fallback.error) throw fallback.error;
      return (fallback.data ?? []) as PipelineJobRunwayRow[];
    }
    throw error;
  }

  return (data ?? []) as PipelineJobRunwayRow[];
}

export async function fetchClientIdToAccountId(clientIds: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(clientIds.filter(Boolean))];
  if (unique.length === 0) return {};
  const supabase = getSupabase();
  const map: Record<string, string> = {};
  const chunk = 100;
  for (let i = 0; i < unique.length; i += chunk) {
    const slice = unique.slice(i, i + chunk);
    const { data, error } = await supabase.from("clients").select("id, source_account_id").in("id", slice);
    if (error) throw error;
    for (const row of data ?? []) {
      const r = row as { id?: string; source_account_id?: string | null };
      const cid = r.id?.trim();
      const aid = r.source_account_id?.trim();
      if (cid && aid) map[cid] = aid;
    }
  }
  return map;
}
