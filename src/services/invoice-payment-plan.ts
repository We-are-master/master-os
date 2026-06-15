import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./base";
import { updateInvoice } from "./invoices";
import {
  activeInstallments,
  countPaidInstallmentsByAmount,
  nextOpenInstallment,
  PAYMENT_PLAN_EPS,
  PAYMENT_PLAN_MAX_INSTALLMENTS,
  paidInstallmentsTotal,
  pickInstallmentForExtraAllocation,
  type PaymentPlanInstallmentDraft,
  validateInstallmentsSum,
  validateOpenInstallmentsSum,
} from "@/lib/invoice-payment-plan";
import { isSupabaseMissingColumnError } from "@/lib/supabase-schema-compat";
import type { Invoice, InvoicePaymentInstallment, PaymentPlanTemplate } from "@/types/database";

export async function listInstallmentsForInvoiceIds(
  invoiceIds: string[],
): Promise<Record<string, InvoicePaymentInstallment[]>> {
  if (invoiceIds.length === 0) return {};
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("invoice_payment_installments")
    .select("*")
    .in("invoice_id", invoiceIds)
    .order("sequence", { ascending: true });
  if (error) {
    if (isSupabaseMissingColumnError(error)) return {};
    throw error;
  }
  const out: Record<string, InvoicePaymentInstallment[]> = {};
  for (const row of (data ?? []) as InvoicePaymentInstallment[]) {
    const list = out[row.invoice_id] ?? [];
    list.push(row);
    out[row.invoice_id] = list;
  }
  return out;
}

export async function listInstallmentsForInvoice(
  invoiceId: string,
): Promise<InvoicePaymentInstallment[]> {
  const map = await listInstallmentsForInvoiceIds([invoiceId]);
  return map[invoiceId] ?? [];
}

export async function createPaymentPlan(
  invoiceId: string,
  invoiceAmount: number,
  drafts: PaymentPlanInstallmentDraft[],
): Promise<InvoicePaymentInstallment[]> {
  if (drafts.length < 1) throw new Error("At least one installment is required.");
  if (drafts.length > PAYMENT_PLAN_MAX_INSTALLMENTS) {
    throw new Error(`Maximum ${PAYMENT_PLAN_MAX_INSTALLMENTS} installments allowed.`);
  }
  if (!validateInstallmentsSum(invoiceAmount, drafts)) {
    throw new Error("Installment amounts must sum to the invoice total.");
  }

  const supabase = getSupabase();
  const rows = drafts.map((d, idx) => ({
    invoice_id: invoiceId,
    sequence: idx + 1,
    amount: Math.round(Number(d.amount) * 100) / 100,
    due_date: d.due_date.slice(0, 10),
    status: "pending" as const,
  }));

  const { error: delErr } = await supabase
    .from("invoice_payment_installments")
    .delete()
    .eq("invoice_id", invoiceId);
  if (delErr && !isSupabaseMissingColumnError(delErr)) throw delErr;

  const { data, error } = await supabase
    .from("invoice_payment_installments")
    .insert(rows)
    .select();
  if (error) throw error;

  const firstDue = drafts[0]!.due_date.slice(0, 10);
  await updateInvoice(invoiceId, {
    due_date: firstDue,
    payment_plan_active: true,
  } as Partial<Invoice>);

  return (data ?? []) as InvoicePaymentInstallment[];
}

/** Replace installment rows when none are paid yet. */
export async function updatePaymentPlan(
  invoiceId: string,
  invoiceAmount: number,
  drafts: PaymentPlanInstallmentDraft[],
): Promise<InvoicePaymentInstallment[]> {
  const existing = await listInstallmentsForInvoice(invoiceId);
  const paid = activeInstallments(existing).filter((i) => i.status === "paid");
  if (paid.length === 0) {
    return createPaymentPlan(invoiceId, invoiceAmount, drafts);
  }
  return updateOpenPaymentPlanInstallments(invoiceId, invoiceAmount, drafts);
}

/** Replace pending installments only; paid rows stay untouched. */
export async function updateOpenPaymentPlanInstallments(
  invoiceId: string,
  invoiceAmount: number,
  openDrafts: PaymentPlanInstallmentDraft[],
): Promise<InvoicePaymentInstallment[]> {
  if (openDrafts.length < 1) {
    throw new Error("At least one open installment is required.");
  }
  if (openDrafts.length > PAYMENT_PLAN_MAX_INSTALLMENTS) {
    throw new Error(`Maximum ${PAYMENT_PLAN_MAX_INSTALLMENTS} installments allowed.`);
  }
  if (openDrafts.some((d) => !d.due_date?.trim())) {
    throw new Error("Set a due date for each open installment.");
  }

  const existing = await listInstallmentsForInvoice(invoiceId);
  const paid = activeInstallments(existing).filter((i) => i.status === "paid");
  if (paid.length === 0) {
    throw new Error("No paid installments — use full plan update instead.");
  }

  const paidSum = paidInstallmentsTotal(paid);
  if (!validateOpenInstallmentsSum(invoiceAmount, paidSum, openDrafts)) {
    throw new Error("Open installments plus paid amount must sum to the invoice total.");
  }

  const supabase = getSupabase();
  const pendingIds = activeInstallments(existing)
    .filter((i) => i.status === "pending")
    .map((i) => i.id);
  if (pendingIds.length > 0) {
    const { error: delErr } = await supabase
      .from("invoice_payment_installments")
      .delete()
      .in("id", pendingIds);
    if (delErr) throw delErr;
  }

  const nextSeq = Math.max(...paid.map((p) => p.sequence)) + 1;
  const rows = openDrafts.map((d, idx) => ({
    invoice_id: invoiceId,
    sequence: nextSeq + idx,
    amount: Math.round(Number(d.amount) * 100) / 100,
    due_date: d.due_date.slice(0, 10),
    status: "pending" as const,
  }));

  const { data, error } = await supabase
    .from("invoice_payment_installments")
    .insert(rows)
    .select();
  if (error) throw error;

  const inserted = (data ?? []) as InvoicePaymentInstallment[];
  const all = [...paid, ...inserted].sort((a, b) => a.sequence - b.sequence);
  const next = nextOpenInstallment(all);
  await updateInvoice(invoiceId, {
    due_date: next?.due_date?.slice(0, 10) ?? paid[paid.length - 1]!.due_date.slice(0, 10),
    payment_plan_active: true,
  } as Partial<Invoice>);

  return all;
}

export async function cancelPaymentPlan(invoiceId: string): Promise<void> {
  const supabase = getSupabase();
  const existing = await listInstallmentsForInvoice(invoiceId);
  if (existing.some((i) => i.status === "paid")) {
    throw new Error("Cannot cancel plan after an installment was paid.");
  }
  const { error } = await supabase
    .from("invoice_payment_installments")
    .delete()
    .eq("invoice_id", invoiceId);
  if (error) throw error;
  await updateInvoice(invoiceId, { payment_plan_active: false } as Partial<Invoice>);
}

/** Mark every pending installment paid and close the invoice. */
export async function markAllInstallmentsPaid(
  invoice: Invoice,
): Promise<{ installments: InvoicePaymentInstallment[]; invoice: Invoice }> {
  const supabase = getSupabase();
  const installments = await listInstallmentsForInvoice(invoice.id);
  const pending = activeInstallments(installments).filter((i) => i.status === "pending");
  if (pending.length === 0) {
    throw new Error("No pending installments to pay.");
  }

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  for (const inst of pending) {
    const { error } = await supabase
      .from("invoice_payment_installments")
      .update({ status: "paid", paid_at: now })
      .eq("id", inst.id);
    if (error) throw error;
  }

  const invAmt = Math.round(Number(invoice.amount ?? 0) * 100) / 100;
  const inv = await updateInvoice(invoice.id, {
    amount_paid: invAmt,
    status: "paid",
    paid_date: today,
    collection_stage: "completed",
  } as Partial<Invoice>);

  const updated = await listInstallmentsForInvoice(invoice.id);
  return { installments: updated, invoice: inv };
}

export async function markInstallmentPaid(
  installmentId: string,
  invoice: Invoice,
): Promise<{ installments: InvoicePaymentInstallment[]; invoice: Invoice }> {
  const supabase = getSupabase();
  const installments = await listInstallmentsForInvoice(invoice.id);
  const target = installments.find((i) => i.id === installmentId);
  if (!target || target.status !== "pending") {
    throw new Error("Installment not found or already paid.");
  }

  const now = new Date().toISOString();
  const { error: upErr } = await supabase
    .from("invoice_payment_installments")
    .update({ status: "paid", paid_at: now })
    .eq("id", installmentId);
  if (upErr) throw upErr;

  const updated = await listInstallmentsForInvoice(invoice.id);
  const next = nextOpenInstallment(updated);
  const allPaid = !next;
  const paidSum = activeInstallments(updated)
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + Number(i.amount ?? 0), 0);
  const invAmt = Number(invoice.amount ?? 0);

  const patch: Partial<Invoice> = {
    amount_paid: Math.min(Math.round(paidSum * 100) / 100, invAmt),
    due_date: next?.due_date?.slice(0, 10) ?? invoice.due_date,
    status: allPaid ? "paid" : "partially_paid",
  };
  if (allPaid) {
    patch.paid_date = new Date().toISOString().slice(0, 10);
    patch.collection_stage = "completed";
  } else {
    patch.paid_date = null;
  }

  const inv = await updateInvoice(invoice.id, patch);
  return { installments: updated, invoice: inv };
}

/** Sync installment paid flags + invoice due_date from cumulative amount_paid (FIFO). */
export async function syncPaymentPlanFromAmountPaid(
  client: SupabaseClient,
  inv: Invoice,
): Promise<void> {
  if (!inv.payment_plan_active) return;
  const installments = await listInstallmentsForInvoice(inv.id);
  if (installments.length === 0) return;

  const amountPaid = Math.round(Number(inv.amount_paid ?? 0) * 100) / 100;
  const invAmt = Math.round(Number(inv.amount ?? 0) * 100) / 100;
  let remaining = amountPaid;
  const now = new Date().toISOString();
  const active = activeInstallments(installments);

  for (const inst of active) {
    const amt = Math.round(Number(inst.amount ?? 0) * 100) / 100;
    const shouldBePaid = remaining + PAYMENT_PLAN_EPS >= amt;
    if (shouldBePaid && inst.status === "pending") {
      remaining = Math.round((remaining - amt) * 100) / 100;
      await client
        .from("invoice_payment_installments")
        .update({ status: "paid", paid_at: now })
        .eq("id", inst.id);
    } else if (!shouldBePaid && inst.status === "paid") {
      await client
        .from("invoice_payment_installments")
        .update({ status: "pending", paid_at: null })
        .eq("id", inst.id);
    }
  }

  const refreshed = await listInstallmentsForInvoice(inv.id);
  const next = nextOpenInstallment(refreshed);
  const allPaid = amountPaid + PAYMENT_PLAN_EPS >= invAmt;
  const patch: Record<string, unknown> = {};
  if (next) {
    patch.due_date = next.due_date.slice(0, 10);
  }
  if (allPaid && inv.status !== "paid") {
    patch.status = "paid";
    patch.paid_date = inv.paid_date ?? new Date().toISOString().slice(0, 10);
    patch.collection_stage = "completed";
  }
  if (Object.keys(patch).length > 0) {
    await client.from("invoices").update(patch).eq("id", inv.id);
  }
}

/** Add delta to nearest upcoming installment when invoice total increases. */
export async function allocateInvoiceExtraToInstallment(
  invoiceId: string,
  delta: number,
  extraDateYmd: string,
): Promise<void> {
  if (Math.abs(delta) <= PAYMENT_PLAN_EPS) return;
  const supabase = getSupabase();
  const installments = await listInstallmentsForInvoice(invoiceId);
  if (installments.length === 0) return;
  const target = pickInstallmentForExtraAllocation(installments, extraDateYmd);
  if (!target) return;
  const newAmt = Math.round((Number(target.amount ?? 0) + delta) * 100) / 100;
  const { error } = await supabase
    .from("invoice_payment_installments")
    .update({ amount: newAmt })
    .eq("id", target.id);
  if (error) throw error;
}

export async function saveSeriesPaymentPlanTemplate(
  seriesId: string,
  template: PaymentPlanTemplate | null,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("job_recurrence_series")
    .update({ payment_plan_template: template })
    .eq("id", seriesId);
  if (error && !isSupabaseMissingColumnError(error)) throw error;
}

export function installmentsPaidCount(
  installments: InvoicePaymentInstallment[],
  amountPaid: number,
): number {
  return countPaidInstallmentsByAmount(installments, amountPaid);
}
