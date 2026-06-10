import { getSupabase } from "@/services/base";
import { invoiceBalanceDueWithJobCustomerPaid } from "@/lib/invoice-balance";
import { isLegacyMisclassifiedCustomerPayment } from "@/lib/job-payment-ledger";
import {
  invoiceFinanceListTodayYmd,
  invoiceIsDerivedOverdue,
  isAwaitingPaymentTabStatus,
} from "@/lib/invoice-finance-tab";
import type { Invoice, JobStatus } from "@/types/database";

export { invoiceFinanceListTodayYmd } from "@/lib/invoice-finance-tab";

export type InvoiceListJobSnapshot = {
  id: string;
  status: JobStatus;
  scheduled_date?: string | null;
  scheduled_start_at?: string | null;
  completed_date?: string | null;
  scheduled_finish_date?: string | null;
  scheduled_end_at?: string | null;
  property_address?: string | null;
  title?: string | null;
  billed_hours?: number | null;
};

export async function fetchAllActiveInvoices(): Promise<Invoice[]> {
  const supabase = getSupabase();
  const acc: Invoice[] = [];
  const chunkSize = 500;
  for (let from = 0; from < 100_000; from += chunkSize) {
    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(from, from + chunkSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as Invoice[];
    if (rows.length === 0) break;
    acc.push(...rows);
    if (rows.length < chunkSize) break;
  }
  return acc;
}

export async function fetchJobsByReferences(refs: string[]): Promise<Record<string, InvoiceListJobSnapshot>> {
  const map: Record<string, InvoiceListJobSnapshot> = {};
  if (refs.length === 0) return map;
  const supabase = getSupabase();
  const CHUNK = 100;
  for (let i = 0; i < refs.length; i += CHUNK) {
    const chunk = refs.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("jobs")
      .select(
        "id, reference, status, scheduled_date, scheduled_start_at, completed_date, scheduled_finish_date, scheduled_end_at, property_address, title, billed_hours",
      )
      .in("reference", chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      const r = row as InvoiceListJobSnapshot & { reference?: string | null };
      const ref = (r.reference ?? "").trim();
      const jid = (row as { id?: string }).id?.trim();
      if (ref && r.status && jid) {
        map[ref] = { ...r, id: jid };
      }
    }
  }
  return map;
}

export async function fetchCustomerPaidSumByJobIds(jobIds: string[]): Promise<Record<string, number>> {
  const sums: Record<string, number> = {};
  for (const id of jobIds) sums[id] = 0;
  const unique = [...new Set(jobIds.filter(Boolean))];
  if (unique.length === 0) return sums;
  const supabase = getSupabase();
  const CHUNK = 100;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("job_payments")
      .select("job_id, amount, type, note")
      .in("job_id", chunk)
      .in("type", ["customer_deposit", "customer_final"])
      .is("deleted_at", null);
    if (error) throw error;
    for (const row of data ?? []) {
      const p = row as { job_id?: string; amount?: number; type?: string; note?: string | null };
      const jid = p.job_id?.trim();
      if (!jid) continue;
      if (isLegacyMisclassifiedCustomerPayment(p as { type: string; note?: string | null })) continue;
      sums[jid] = (sums[jid] ?? 0) + Number(p.amount ?? 0);
    }
  }
  for (const id of Object.keys(sums)) {
    sums[id] = Math.round(sums[id] * 100) / 100;
  }
  return sums;
}

export function invoiceListBalanceDue(
  inv: Invoice,
  jobsByRef: Record<string, InvoiceListJobSnapshot>,
  customerPaidByJobId: Record<string, number>,
): number {
  const ref = inv.job_reference?.trim();
  const jid = ref ? jobsByRef[ref]?.id : undefined;
  const ledgerSum = jid !== undefined ? customerPaidByJobId[jid] : undefined;
  return invoiceBalanceDueWithJobCustomerPaid(inv, ledgerSum);
}

export function effectiveInvoiceSourceAccountId(
  inv: Pick<Invoice, "source_account_id" | "job_reference" | "client_name">,
  jobRefToAccountId: Record<string, string>,
  clientNameToAccountId: Record<string, string>,
): string | null {
  const direct = inv.source_account_id?.trim();
  if (direct) return direct;
  const ref = inv.job_reference?.trim();
  if (ref) {
    const fromJob = jobRefToAccountId[ref]?.trim();
    if (fromJob) return fromJob;
  }
  const cn = inv.client_name?.trim();
  if (cn) {
    const fromName = clientNameToAccountId[cn]?.trim();
    if (fromName) return fromName;
  }
  return null;
}

export function isInvoiceOpen(inv: Invoice, todayYmd = invoiceFinanceListTodayYmd()): boolean {
  if (inv.status === "paid" || inv.status === "cancelled") return false;
  return true;
}

/** Ready for Money In — issued, not draft/on_hold, linked job not on hold. */
export function isInvoiceCollectible(
  inv: Invoice,
  jobsByRef?: Record<string, InvoiceListJobSnapshot>,
  todayYmd = invoiceFinanceListTodayYmd(),
): boolean {
  if (inv.status === "draft" || inv.status === "on_hold") return false;
  if (!isInvoiceOpen(inv, todayYmd)) return false;
  const ref = inv.job_reference?.trim();
  if (ref && jobsByRef?.[ref]?.status === "on_hold") return false;
  return true;
}

export function invoiceDisplayStatus(
  inv: Invoice,
  todayYmd = invoiceFinanceListTodayYmd(),
  jobsByRef?: Record<string, InvoiceListJobSnapshot>,
): "Overdue" | "Sent" | "Paid" | "Draft" | "Partial" | "Cancelled" | "On hold" {
  if (inv.status === "paid") return "Paid";
  if (inv.status === "cancelled") return "Cancelled";
  if (inv.status === "on_hold") return "On hold";
  const ref = inv.job_reference?.trim();
  if (ref && jobsByRef?.[ref]?.status === "on_hold") return "On hold";
  if (inv.status === "draft") return "Draft";
  if (inv.status === "partially_paid") return "Partial";
  if (invoiceIsDerivedOverdue(inv, todayYmd)) return "Overdue";
  if (isAwaitingPaymentTabStatus(inv.status) || inv.status === "pending") return "Sent";
  return "Sent";
}

export function vatSplitFromGross(amount: number): { net: number; vat: number; total: number } {
  const total = Math.max(0, Math.round(amount * 100) / 100);
  const vat = Math.round((total / 6) * 100) / 100;
  const net = Math.max(0, Math.round((total - vat) * 100) / 100);
  return { net, vat, total };
}
