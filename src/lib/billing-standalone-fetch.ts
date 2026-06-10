import { getSupabase } from "@/services/base";
import { fetchAllActiveInvoices } from "@/lib/billing-invoice-list-data";
import { addDaysYmd, type YmdBounds } from "@/lib/billing-standalone-period";
import { isSupabaseMissingColumnError } from "@/lib/supabase-schema-compat";
import type { Invoice, SelfBill } from "@/types/database";

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
