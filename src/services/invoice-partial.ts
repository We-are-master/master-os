import { getSupabase } from "./base";
import { createJobPayment } from "./job-payments";
import type { Invoice, Job, JobPaymentType } from "@/types/database";
import { invoiceBalanceDue } from "@/lib/invoice-balance";
import { syncJobAfterInvoicePaidToLedger } from "@/lib/sync-job-after-invoice-paid";
import { syncInvoicesFromJobCustomerPayments } from "@/lib/sync-invoices-from-job-payments";
import { maybeCompleteAwaitingPaymentJob } from "@/lib/sync-job-after-invoice-paid";
import { listJobPayments } from "./job-payments";

const EPS = 0.02;

function allocateToDepositAndFinal(
  job: Job,
  depositPaid: number,
  finalPaid: number,
  paymentAmount: number,
): { type: JobPaymentType; amount: number }[] {
  const depNeed = Number(job.customer_deposit ?? 0);
  const finNeed = Number(job.customer_final_payment ?? 0);
  const depRem = Math.max(0, depNeed - depositPaid);
  let left = Math.round(paymentAmount * 100) / 100;
  const out: { type: JobPaymentType; amount: number }[] = [];
  if (depRem > EPS && left > EPS) {
    const d = Math.min(left, depRem);
    out.push({ type: "customer_deposit", amount: Math.round(d * 100) / 100 });
    left = Math.round((left - d) * 100) / 100;
  }
  if (left > EPS) {
    if (finNeed > EPS) {
      const f = Math.min(left, Math.max(0, finNeed - finalPaid));
      if (f > EPS) {
        out.push({ type: "customer_final", amount: Math.round(f * 100) / 100 });
        left = Math.round((left - f) * 100) / 100;
      }
    }
    if (left > EPS) {
      out.push({ type: "customer_final", amount: left });
    }
  }
  return out;
}

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

  const chunks = allocateToDepositAndFinal(job, depositPaid, finalPaid, payAmt);
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
