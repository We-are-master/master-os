import { getSupabase } from "@/services/base";
import { fetchAllActiveInvoices } from "@/lib/billing-invoice-list-data";
import type { YmdBounds } from "@/lib/billing-standalone-period";
import type { Invoice, SelfBill } from "@/types/database";

const PAGE_SIZE = 500;
const MAX_PAGES = 40;

const CLOSED_INVOICE_STATUSES = ["paid", "cancelled"] as const;
const CLOSED_SELF_BILL_STATUSES = [
  "paid",
  "rejected",
  "payout_cancelled",
  "payout_archived",
  "payout_lost",
] as const;

type InvoiceRowQuery = {
  not: (col: string, op: string, val: string) => InvoiceRowQuery;
  gte: (col: string, val: string) => InvoiceRowQuery;
  lte: (col: string, val: string) => InvoiceRowQuery;
  eq: (col: string, val: string) => InvoiceRowQuery;
  order: (col: string, opts: { ascending: boolean }) => InvoiceRowQuery;
  range: (from: number, to: number) => Promise<{ data: Invoice[] | null; error: Error | null }>;
};

async function fetchInvoiceQueryPages(apply: (q: InvoiceRowQuery) => InvoiceRowQuery): Promise<Invoice[]> {
  const supabase = getSupabase();
  const acc: Invoice[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const base = supabase.from("invoices").select("*").is("deleted_at", null) as unknown as InvoiceRowQuery;
    const { data, error } = await apply(base)
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

function mergeInvoicesById(rows: Invoice[]): Invoice[] {
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

  const closedList = `(${CLOSED_INVOICE_STATUSES.map((s) => `"${s}"`).join(",")})`;

  const [openRows, dueRows, paidByDueRows, paidByPaidDateRows, paidByStripeRows] = await Promise.all([
    fetchInvoiceQueryPages((q) => q.not("status", "in", closedList)),
    fetchInvoiceQueryPages((q) => q.gte("due_date", bounds.from).lte("due_date", bounds.to)),
    fetchInvoiceQueryPages((q) =>
      q.eq("status", "paid").gte("paid_date", bounds.from).lte("paid_date", bounds.to),
    ),
    fetchInvoiceQueryPages((q) =>
      q.eq("status", "paid").gte("last_payment_date", bounds.from).lte("last_payment_date", bounds.to),
    ),
    fetchInvoiceQueryPages((q) =>
      q
        .eq("status", "paid")
        .gte("stripe_paid_at", `${bounds.from}T00:00:00`)
        .lte("stripe_paid_at", `${bounds.to}T23:59:59`),
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

type SelfBillRowQuery = {
  not: (col: string, op: string, val: string) => SelfBillRowQuery;
  gte: (col: string, val: string) => SelfBillRowQuery;
  lte: (col: string, val: string) => SelfBillRowQuery;
  order: (col: string, opts: { ascending: boolean }) => SelfBillRowQuery;
  range: (from: number, to: number) => Promise<{ data: SelfBill[] | null; error: Error | null }>;
};

async function fetchSelfBillQueryPages(apply: (q: SelfBillRowQuery) => SelfBillRowQuery): Promise<SelfBill[]> {
  const supabase = getSupabase();
  const acc: SelfBill[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const base = supabase.from("self_bills").select("*") as unknown as SelfBillRowQuery;
    const { data, error } = await apply(base)
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

function mergeSelfBillsById(rows: SelfBill[]): SelfBill[] {
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

  const closedList = `(${CLOSED_SELF_BILL_STATUSES.map((s) => `"${s}"`).join(",")})`;

  const [openRows, overlapRows, weekEndRows] = await Promise.all([
    fetchSelfBillQueryPages((q) => q.not("status", "in", closedList)),
    fetchSelfBillQueryPages((q) => q.lte("week_start", bounds.to).gte("week_end", bounds.from)),
    fetchSelfBillQueryPages((q) => q.gte("week_end", bounds.from).lte("week_end", bounds.to)),
  ]);

  return mergeSelfBillsById([...openRows, ...overlapRows, ...weekEndRows]);
}
