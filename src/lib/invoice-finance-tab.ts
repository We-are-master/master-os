import {
  invoiceIsDerivedOverdueWithPlan,
  invoiceEffectiveDueYmd,
} from "@/lib/invoice-payment-plan";
import type { Invoice, InvoicePaymentInstallment } from "@/types/database";

/** Finance Invoices list tabs (UI). Filtering is by invoice row status only. */
export const INVOICE_FINANCE_TAB_ORDER = [
  "all",
  "draft",
  "awaiting_payment",
  "overdue",
  "paid",
  "cancelled",
] as const;

export type InvoiceFinanceTab = (typeof INVOICE_FINANCE_TAB_ORDER)[number];

/** Awaiting tab = still collecting, not yet marked overdue in the DB. */
const AWAITING_STATUSES = new Set<Invoice["status"]>(["pending", "partially_paid", "audit_required"]);

/** Civil YYYY-MM-DD from `due_date` (expected payment date). */
export function invoiceExpectedDateYmd(inv: Invoice): string {
  const raw = (inv.due_date ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

/** Local calendar today as YYYY-MM-DD (list UI / client). */
export function invoiceFinanceListTodayYmd(): string {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const d = String(n.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isInvoicePastExpectedDate(inv: Invoice, todayYmd: string): boolean {
  const exp = invoiceExpectedDateYmd(inv);
  if (!exp) return false;
  return todayYmd > exp;
}

/**
 * Overdue on the list: DB `overdue`, or awaiting-collection statuses with expected date in the past.
 * (No new backend status — derived in UI.)
 */
export function invoiceIsDerivedOverdue(
  inv: Invoice,
  todayYmd: string,
  installments?: InvoicePaymentInstallment[] | null,
): boolean {
  if (installments?.length) {
    return invoiceIsDerivedOverdueWithPlan(inv, installments, todayYmd);
  }
  if (inv.status === "overdue") return true;
  if (!AWAITING_STATUSES.has(inv.status)) return false;
  return isInvoicePastExpectedDate(inv, todayYmd);
}

/** Effective due date for display — next open installment when plan active. */
export function invoiceDisplayDueYmd(
  inv: Invoice,
  installments?: InvoicePaymentInstallment[] | null,
): string {
  if (installments?.length) return invoiceEffectiveDueYmd(inv, installments);
  return invoiceExpectedDateYmd(inv);
}

export function invoiceMatchesFinanceTab(inv: Invoice, tab: InvoiceFinanceTab): boolean {
  const todayYmd = invoiceFinanceListTodayYmd();
  /** "All" = draft + awaiting + overdue only. Paid and cancelled have their own tabs. */
  if (tab === "all") return inv.status !== "cancelled" && inv.status !== "paid";
  if (tab === "draft") return inv.status === "draft";
  if (tab === "paid") return inv.status === "paid";
  if (tab === "cancelled") return inv.status === "cancelled";
  if (tab === "overdue") return invoiceIsDerivedOverdue(inv, todayYmd);
  if (tab === "awaiting_payment") {
    return AWAITING_STATUSES.has(inv.status) && !invoiceIsDerivedOverdue(inv, todayYmd);
  }
  return false;
}

/** Pending / partial / audit — matches the "Awaiting payment" tab (excludes overdue). */
export function isAwaitingPaymentTabStatus(status: Invoice["status"]): boolean {
  return AWAITING_STATUSES.has(status);
}

/** Any invoice still being collected, including DB `overdue` (highlights, quick actions, group totals). */
export function isAwaitingPaymentInvoiceStatus(status: Invoice["status"]): boolean {
  return AWAITING_STATUSES.has(status) || status === "overdue";
}

/**
 * Effective display status: returns `"overdue"` when the invoice is past its due date
 * even if the DB status is still `"pending"` / `"partially_paid"` / `"audit_required"`.
 * Does not persist — for UI display and filtering only.
 */
export function getEffectiveStatus(
  inv: Invoice,
  installments?: InvoicePaymentInstallment[] | null,
): Invoice["status"] {
  const todayYmd = invoiceFinanceListTodayYmd();
  if (invoiceIsDerivedOverdue(inv, todayYmd, installments)) return "overdue";
  return inv.status;
}
