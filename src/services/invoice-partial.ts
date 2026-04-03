import { getSupabase } from "./base";
import { createJobPayment } from "./job-payments";
import type { Invoice, Job } from "@/types/database";
import { invoiceBalanceDue } from "@/lib/invoice-balance";
import { syncJobAfterInvoicePaidToLedger } from "@/lib/sync-job-after-invoice-paid";
import { syncInvoicesFromJobCustomerPayments } from "@/lib/sync-invoices-from-job-payments";
import { maybeCompleteAwaitingPaymentJob } from "@/lib/sync-job-after-invoice-paid";
import { listJobPayments } from "./job-payments";
import { allocateCustomerPaymentToSchedule } from "@/lib/allocate-customer-payment";

const EPS = 0.02;

export type RecordInvoicePartialInput = {
  paymentDate: string;
  note?: string;
  createdBy?: string;
  paymentMethod?: import("@/types/database").JobPaymentMethod;
};

/**
 * Apply a partial (or final) customer payment against an invoice: posts `job_payments` with
 * `linked_invoice_id`, then `syncInvoicesFromJobCustomerPayments` sets `amount_paid` from the ledger
 * (linked rows take precedence so Finance partials match the job summary).
 */
export async function recordInvoicePartialPayment(
  invoiceId: string,
  amount: number,
  input: RecordInvoicePartialInput,
): Promise<Invoice> {
  const supabase = getSupabase();
  const payAmt = Math.round(amount * 100) / 100;
  if (payAmt <= EPS) throw new Error("Amount must be greater than zero");

  const { data: invRow, error: invErr } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
  if (invErr || !invRow) throw new Error("Invoice not found");
  const inv = invRow as Invoice;
  if (inv.status === "cancelled") throw new Error("Invoice is cancelled");

  const balance = invoiceBalanceDue(inv);
  if (payAmt > balance + EPS) throw new Error(`Amount exceeds balance due (${balance.toFixed(2)})`);

  const ref = inv.job_reference?.trim();
  if (!ref) throw new Error("Invoice has no job reference — link a job before recording payments");

  const { data: jobRow, error: jErr } = await supabase.from("jobs").select("*").eq("reference", ref).single();
  if (jErr || !jobRow) throw new Error("Job not found for this invoice");
  const job = jobRow as Job;

  const pays = await listJobPayments(job.id);
  const depositPaid = pays.filter((p) => p.type === "customer_deposit").reduce((s, p) => s + Number(p.amount), 0);
  const finalPaid = pays.filter((p) => p.type === "customer_final").reduce((s, p) => s + Number(p.amount), 0);

  const chunks = allocateCustomerPaymentToSchedule(job, depositPaid, finalPaid, payAmt);
  if (chunks.length === 0) {
    throw new Error("Could not allocate payment against this job’s deposit/final schedule");
  }

  const noteBase = input.note?.trim() ? `${input.note.trim()} · ` : "";
  for (const ch of chunks) {
    await createJobPayment({
      job_id: job.id,
      type: ch.type,
      amount: ch.amount,
      payment_date: input.paymentDate,
      note: `${noteBase}Partial ${inv.reference}`,
      payment_method: input.paymentMethod ?? "bank_transfer",
      created_by: input.createdBy,
      linked_invoice_id: inv.id,
    });
  }

  await syncInvoicesFromJobCustomerPayments(supabase, job.id);

  const { data: freshRow, error: freshErr } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
  if (freshErr || !freshRow) throw new Error("Could not refresh invoice after recording payment");
  const fresh = freshRow as Invoice;

  if (fresh.status === "paid") {
    await syncJobAfterInvoicePaidToLedger(supabase, invoiceId, "Manual");
    await syncInvoicesFromJobCustomerPayments(supabase, job.id);
  }

  await maybeCompleteAwaitingPaymentJob(supabase, job.id);

  const { data: out, error: outErr } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
  if (outErr || !out) throw new Error("Could not load updated invoice");
  return out as Invoice;
}
