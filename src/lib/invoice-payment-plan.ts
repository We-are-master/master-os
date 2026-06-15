import { invoiceExpectedDateYmd, invoiceFinanceListTodayYmd } from "@/lib/invoice-finance-tab";
import type { Invoice } from "@/types/database";
import type { InvoicePaymentInstallment, PaymentPlanTemplate } from "@/types/database";

export const PAYMENT_PLAN_EPS = 0.02;
export const PAYMENT_PLAN_MAX_INSTALLMENTS = 120;

const AWAITING_STATUSES = new Set<Invoice["status"]>(["pending", "partially_paid", "audit_required"]);

export type PaymentPlanInstallmentDraft = { amount: number; due_date: string };

export function hasActivePaymentPlan(
  installments: InvoicePaymentInstallment[] | null | undefined,
): boolean {
  return (installments ?? []).some((i) => i.status !== "cancelled");
}

export function activeInstallments(installments: InvoicePaymentInstallment[]): InvoicePaymentInstallment[] {
  return [...installments]
    .filter((i) => i.status !== "cancelled")
    .sort((a, b) => a.sequence - b.sequence);
}

export function nextOpenInstallment(
  installments: InvoicePaymentInstallment[] | null | undefined,
): InvoicePaymentInstallment | null {
  if (!installments?.length) return null;
  return activeInstallments(installments).find((i) => i.status === "pending") ?? null;
}

export function installmentsTotal(
  installments: InvoicePaymentInstallment[] | null | undefined,
): number {
  return Math.round(
    activeInstallments(installments ?? []).reduce((s, i) => s + Number(i.amount ?? 0), 0) * 100,
  ) / 100;
}

export function validateInstallmentsSum(
  invoiceTotal: number,
  drafts: PaymentPlanInstallmentDraft[],
): boolean {
  const sum = Math.round(drafts.reduce((s, d) => s + Number(d.amount ?? 0), 0) * 100) / 100;
  return Math.abs(sum - invoiceTotal) <= PAYMENT_PLAN_EPS;
}

/** Open installments + already-paid amount must equal invoice total. */
export function validateOpenInstallmentsSum(
  invoiceTotal: number,
  paidAmount: number,
  openDrafts: PaymentPlanInstallmentDraft[],
): boolean {
  const paid = Math.round(Number(paidAmount ?? 0) * 100) / 100;
  const openSum = Math.round(openDrafts.reduce((s, d) => s + Number(d.amount ?? 0), 0) * 100) / 100;
  return Math.abs(paid + openSum - invoiceTotal) <= PAYMENT_PLAN_EPS;
}

export function paidInstallmentsTotal(
  installments: { status?: string; amount?: number | null }[],
): number {
  return Math.round(
    activeInstallments(installments as InvoicePaymentInstallment[])
      .filter((i) => i.status === "paid")
      .reduce((s, i) => s + Number(i.amount ?? 0), 0) * 100,
  ) / 100;
}

export function invoiceEffectiveDueYmd(
  inv: Invoice,
  installments: InvoicePaymentInstallment[] | null | undefined,
): string {
  if (hasActivePaymentPlan(installments)) {
    const next = nextOpenInstallment(installments);
    const raw = next?.due_date?.trim().slice(0, 10) ?? "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  }
  return invoiceExpectedDateYmd(inv);
}

export function invoiceIsDerivedOverdueWithPlan(
  inv: Invoice,
  installments: InvoicePaymentInstallment[] | null | undefined,
  todayYmd: string,
): boolean {
  if (inv.status === "overdue") return true;
  if (!AWAITING_STATUSES.has(inv.status)) return false;
  const exp = invoiceEffectiveDueYmd(inv, installments);
  if (!exp) return false;
  return todayYmd > exp;
}

export function daysLateWithPlan(
  inv: Invoice,
  installments: InvoicePaymentInstallment[] | null | undefined,
  todayYmd: string,
): number {
  const due = invoiceEffectiveDueYmd(inv, installments);
  if (!due || todayYmd <= due) return 0;
  const a = new Date(`${due}T12:00:00`);
  const b = new Date(`${todayYmd}T12:00:00`);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

/** Pending installment id that should absorb an extra amount (nearest due on/after extraDate). */
export function pickInstallmentForExtraAllocation(
  installments: InvoicePaymentInstallment[],
  extraDateYmd: string,
): InvoicePaymentInstallment | null {
  const pending = activeInstallments(installments).filter((i) => i.status === "pending");
  if (pending.length === 0) return null;
  const onOrAfter = pending
    .filter((i) => (i.due_date ?? "").slice(0, 10) >= extraDateYmd)
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  if (onOrAfter.length > 0) return onOrAfter[0]!;
  return [...pending].sort((a, b) => (b.due_date ?? "").localeCompare(a.due_date ?? ""))[0] ?? null;
}

export function paymentPlanProgressLabel(
  installments: InvoicePaymentInstallment[] | null | undefined,
): string | null {
  if (!hasActivePaymentPlan(installments)) return null;
  const active = activeInstallments(installments!);
  const paid = active.filter((i) => i.status === "paid").length;
  const total = active.length;
  const next = nextOpenInstallment(installments);
  if (!next) return `${paid}/${total} paid`;
  const due = next.due_date?.slice(0, 10) ?? "";
  const dueFmt = due
    ? new Date(`${due}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : "—";
  return `${paid}/${total} · next due ${dueFmt}`;
}

export type CashflowInstallmentSlice = {
  invoiceId: string;
  installmentId: string;
  dueYmd: string;
  amount: number;
  label: string;
  detail?: string;
};

/** Pending installments for cash-flow bucketing (replaces single invoice due_date when plan active). */
export function cashflowSlicesForInvoice(
  inv: Invoice,
  installments: InvoicePaymentInstallment[] | null | undefined,
): CashflowInstallmentSlice[] {
  if (!hasActivePaymentPlan(installments)) {
    const dueYmd = (inv.due_date ?? "").slice(0, 10);
    if (!dueYmd) return [];
    return [];
  }
  const ref = inv.job_reference?.trim() || inv.reference?.trim();
  return activeInstallments(installments!)
    .filter((i) => i.status === "pending")
    .map((i) => ({
      invoiceId: inv.id,
      installmentId: i.id,
      dueYmd: (i.due_date ?? "").slice(0, 10),
      amount: Math.round(Number(i.amount ?? 0) * 100) / 100,
      label: inv.client_name?.trim() || "Invoice",
      detail: ref || undefined,
    }))
    .filter((s) => s.dueYmd && s.amount > PAYMENT_PLAN_EPS);
}

/** FIFO: how many installments are fully covered by cumulative amount_paid. */
export function countPaidInstallmentsByAmount(
  installments: InvoicePaymentInstallment[],
  amountPaid: number,
): number {
  let remaining = Math.round(Number(amountPaid ?? 0) * 100) / 100;
  let count = 0;
  for (const inst of activeInstallments(installments)) {
    if (inst.status === "paid") {
      count += 1;
      continue;
    }
    const amt = Math.round(Number(inst.amount ?? 0) * 100) / 100;
    if (remaining + PAYMENT_PLAN_EPS >= amt) {
      remaining = Math.round((remaining - amt) * 100) / 100;
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

export function templateFromDrafts(
  enabled: boolean,
  drafts: PaymentPlanInstallmentDraft[],
): PaymentPlanTemplate {
  return {
    enabled,
    installments: drafts.map((d) => ({
      amount: Math.round(Number(d.amount) * 100) / 100,
      due_date: d.due_date.slice(0, 10),
    })),
  };
}

export function splitEqually(total: number, count: number): number[] {
  if (count < 1) return [];
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / count);
  const remainder = cents - base * count;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const c = base + (i < remainder ? 1 : 0);
    out.push(c / 100);
  }
  return out;
}

export function todayYmdForPaymentPlan(): string {
  return invoiceFinanceListTodayYmd();
}
