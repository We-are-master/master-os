import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job } from "@/types/database";
import { customerCollectionsSatisfyBillable, jobBillableRevenue } from "@/lib/job-financials";
import { syncInvoiceCollectionStagesForJob } from "@/lib/invoice-collection";
import { reconcileJobCustomerPaymentFlags } from "@/lib/reconcile-job-customer-flags";
import { invoiceAmountPaid } from "@/lib/invoice-balance";

const EPS = 0.02;

async function loadJobForInvoice(
  client: SupabaseClient,
  inv: { job_reference?: string | null; id?: string },
  invoiceId: string
): Promise<Job | null> {
  const { data: jobByInvoice } = await client.from("jobs").select("*").eq("invoice_id", invoiceId).maybeSingle();
  if (jobByInvoice) return jobByInvoice as Job;
  const ref = inv.job_reference?.trim();
  if (!ref) return null;
  const { data: jobByRef } = await client.from("jobs").select("*").eq("reference", ref).maybeSingle();
  return (jobByRef as Job) ?? null;
}

async function sumLinkedInvoicePayments(client: SupabaseClient, invoiceId: string): Promise<number> {
  const { data: rows } = await client
    .from("job_payments")
    .select("amount")
    .eq("linked_invoice_id", invoiceId)
    .is("deleted_at", null);
  return (rows ?? []).reduce((s, r) => s + Number((r as { amount?: number }).amount ?? 0), 0);
}

/**
 * When a customer invoice is marked paid (Stripe webhook or Finance UI), align job flags and job_payments.
 * Skips duplicate ledger rows if `source_invoice_id` already exists or job collections already satisfy billable.
 */
export async function syncJobAfterInvoicePaidToLedger(
  client: SupabaseClient,
  invoiceId: string,
  sourceLabel: "Stripe" | "Manual"
): Promise<void> {
  const { data: inv, error: invErr } = await client.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (invErr || !inv || inv.status !== "paid") return;

  const job = await loadJobForInvoice(client, inv as { job_reference?: string | null }, invoiceId);
  if (!job) return;

  const { data: pays } = await client
    .from("job_payments")
    .select("type, amount")
    .eq("job_id", job.id)
    .is("deleted_at", null);
  const list = (pays ?? []) as { type: string; amount: number }[];
  const customerTotal = list
    .filter((p) => p.type === "customer_deposit" || p.type === "customer_final")
    .reduce((s, p) => s + Number(p.amount), 0);

  const billable = jobBillableRevenue(job);
  const jobRemaining = Math.max(0, billable - customerTotal);

  const { data: existingSource } = await client
    .from("job_payments")
    .select("id")
    .eq("source_invoice_id", invoiceId)
    .is("deleted_at", null)
    .maybeSingle();

  const linkedSum = await sumLinkedInvoicePayments(client, invoiceId);
  const invPaid = invoiceAmountPaid(inv as { amount_paid?: number });
  const invoiceNotYetOnJobLedger = Math.max(0, invPaid - linkedSum);
  const payAmt = Math.min(jobRemaining, invoiceNotYetOnJobLedger > EPS ? invoiceNotYetOnJobLedger : jobRemaining);

  if (!existingSource && payAmt > EPS) {
    const paidDate = (inv.paid_date as string) || new Date().toISOString().split("T")[0];
    const { error: insErr } = await client.from("job_payments").insert({
      job_id: job.id,
      type: "customer_final",
      amount: Math.round(payAmt * 100) / 100,
      payment_date: paidDate,
      note: `${sourceLabel} · ${(inv as { reference?: string }).reference ?? invoiceId}`,
      source_invoice_id: invoiceId,
      linked_invoice_id: invoiceId,
    });

    if (insErr && (insErr as { code?: string }).code !== "23505") {
      console.error("syncJobAfterInvoicePaidToLedger: job_payments insert", insErr);
      return;
    }
  }

  await reconcileJobCustomerPaymentFlags(client, job.id);
  await syncInvoiceCollectionStagesForJob(client, job.id);
  await maybeCompleteAwaitingPaymentJob(client, job.id);
}

/**
 * If job is awaiting_payment and customer collections cover billable revenue (e.g. Finance marked invoice paid),
 * move to completed & paid. Partner payout is tracked separately in Self-bill / pay-run flows.
 */
export async function maybeCompleteAwaitingPaymentJob(client: SupabaseClient, jobId: string): Promise<void> {
  const { data: row, error } = await client.from("jobs").select("*").eq("id", jobId).maybeSingle();
  if (error || !row) return;
  const job = row as Job;
  if (job.status !== "awaiting_payment") return;

  const { data: pays } = await client
    .from("job_payments")
    .select("type, amount")
    .eq("job_id", jobId)
    .is("deleted_at", null);
  const list = (pays ?? []) as { type: string; amount: number }[];
  const customerPayments = list
    .filter((p) => p.type === "customer_deposit" || p.type === "customer_final")
    .map((p) => ({ type: p.type as "customer_deposit" | "customer_final", amount: Number(p.amount) }));

  if (!customerCollectionsSatisfyBillable(job, customerPayments)) return;

  await client.from("jobs").update({ status: "completed", finance_status: "paid" }).eq("id", jobId);
}
