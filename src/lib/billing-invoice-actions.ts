import { getSupabase } from "@/services/base";
import { reopenInvoiceToPending } from "@/lib/invoice-reopen";
import { syncInvoicesFromJobCustomerPayments } from "@/lib/sync-invoices-from-job-payments";
import { maybeCompleteAwaitingPaymentJob, syncJobAfterInvoicePaidToLedger } from "@/lib/sync-job-after-invoice-paid";
import { bumpLinkedInvoiceAmountsToJobSchedule } from "@/lib/sync-invoice-amount-from-job";
import { updateInvoice } from "@/services/invoices";
import { logBulkAction } from "@/services/audit";
import type { Invoice, InvoiceStatus, Job } from "@/types/database";

export async function bulkMarkInvoicesPaid(
  ids: string[],
  profile?: { id?: string; full_name?: string | null },
): Promise<void> {
  if (ids.length === 0) return;
  const supabase = getSupabase();
  const today = new Date().toISOString().split("T")[0];
  for (const id of ids) {
    const { data: inv } = await supabase.from("invoices").select("amount").eq("id", id).maybeSingle();
    const amt = Number((inv as { amount?: number } | null)?.amount ?? 0);
    await updateInvoice(id, {
      status: "paid",
      paid_date: today,
      collection_stage: "completed",
      amount_paid: amt,
    });
    await syncJobAfterInvoicePaidToLedger(supabase, id, "Manual");
  }
  await logBulkAction("invoice", ids, "status_changed", "status", "paid", profile?.id, profile?.full_name ?? undefined);
}

export async function bulkUpdateInvoiceStatus(
  ids: string[],
  newStatus: string,
  profile?: { id?: string; full_name?: string | null },
): Promise<void> {
  const supabase = getSupabase();
  if (newStatus === "pending") {
    for (const id of ids) {
      const { data: inv } = await supabase.from("invoices").select("*").eq("id", id).maybeSingle();
      if (!inv) continue;
      const row = inv as Invoice;
      if (row.status === "paid" || row.status === "partially_paid") {
        await reopenInvoiceToPending(supabase, row);
      } else {
        await supabase.from("invoices").update({ status: "pending", paid_date: null }).eq("id", id);
      }
    }
    await logBulkAction("invoice", ids, "status_changed", "status", newStatus, profile?.id, profile?.full_name ?? undefined);
    return;
  }
  const { error } = await supabase.from("invoices").update({ status: newStatus }).in("id", ids);
  if (error) throw error;
  await logBulkAction("invoice", ids, "status_changed", "status", newStatus, profile?.id, profile?.full_name ?? undefined);
}

export async function syncInvoicesForJobIds(jobIds: string[]): Promise<number> {
  const supabase = getSupabase();
  let n = 0;
  for (const jobId of jobIds) {
    const { data: jobRow } = await supabase.from("jobs").select("*").eq("id", jobId).maybeSingle();
    const job = jobRow as Job | null;
    if (job) {
      await bumpLinkedInvoiceAmountsToJobSchedule(job);
    } else {
      await syncInvoicesFromJobCustomerPayments(supabase, jobId);
    }
    n += 1;
  }
  return n;
}

export async function updateInvoiceStatusOne(
  invoice: Invoice,
  newStatus: InvoiceStatus,
): Promise<Invoice> {
  const supabase = getSupabase();
  const updates: Record<string, unknown> = { status: newStatus };
  if (newStatus === "paid") {
    updates.paid_date = new Date().toISOString().split("T")[0];
    updates.collection_stage = "completed";
    updates.amount_paid = Number(invoice.amount);
  } else if (invoice.status === "paid") {
    updates.paid_date = null;
  }
  await updateInvoice(invoice.id, updates as Partial<Invoice>);
  if (newStatus === "paid") {
    await syncJobAfterInvoicePaidToLedger(supabase, invoice.id, "Manual");
  }
  if (invoice.job_reference?.trim()) {
    const { data: jobRow } = await supabase.from("jobs").select("id").eq("reference", invoice.job_reference.trim()).maybeSingle();
    const jid = (jobRow as { id?: string } | null)?.id;
    if (jid) {
      await syncInvoicesFromJobCustomerPayments(supabase, jid);
      await maybeCompleteAwaitingPaymentJob(supabase, jid);
    }
  }
  const { data: fresh } = await supabase.from("invoices").select("*").eq("id", invoice.id).maybeSingle();
  return (fresh as Invoice) ?? { ...invoice, status: newStatus };
}
