import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job } from "@/types/database";
import { canMarkJobCompletedFinancially } from "@/lib/job-financials";
import { syncInvoiceCollectionStagesForJob } from "@/lib/invoice-collection";
import { reconcileJobCustomerPaymentFlags } from "@/lib/reconcile-job-customer-flags";

function nearEqual(a: number, b: number, eps = 0.02): boolean {
  return Math.abs(a - b) <= eps;
}

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

/**
 * When a customer invoice is marked paid (Stripe webhook or Finance UI), align job flags and job_payments.
 * Idempotent per invoice id (`source_invoice_id`).
 */
export async function syncJobAfterInvoicePaidToLedger(
  client: SupabaseClient,
  invoiceId: string,
  sourceLabel: "Stripe" | "Manual"
): Promise<void> {
  const { data: inv, error: invErr } = await client.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (invErr || !inv || inv.status !== "paid") return;

  const { data: existingPay } = await client
    .from("job_payments")
    .select("id")
    .eq("source_invoice_id", invoiceId)
    .is("deleted_at", null)
    .maybeSingle();

  const job = await loadJobForInvoice(client, inv as { job_reference?: string | null }, invoiceId);
  if (!job) return;

  if (!existingPay) {
    const amt = Number(inv.amount ?? 0);
    const dep = Number(job.customer_deposit ?? 0);
    const fin = Number(job.customer_final_payment ?? 0);
    const paidDate = (inv.paid_date as string) || new Date().toISOString().split("T")[0];

    type PayType = "customer_deposit" | "customer_final";
    let paymentType: PayType = "customer_deposit";

    const isPrimaryLinked = job.invoice_id === invoiceId;

    if (nearEqual(amt, dep + fin) && dep > 0 && fin > 0) {
      paymentType = "customer_final";
    } else if (isPrimaryLinked) {
      paymentType = dep > 0.01 ? "customer_deposit" : "customer_final";
    } else {
      if (dep > 0.01 && nearEqual(amt, dep) && !job.customer_deposit_paid) {
        paymentType = "customer_deposit";
      } else {
        paymentType = "customer_final";
      }
    }

    const { error: insErr } = await client.from("job_payments").insert({
      job_id: job.id,
      type: paymentType,
      amount: amt,
      payment_date: paidDate,
      note: `${sourceLabel} · ${(inv as { reference?: string }).reference ?? invoiceId}`,
      source_invoice_id: invoiceId,
    });

    if (insErr) {
      if ((insErr as { code?: string }).code !== "23505") {
        console.error("syncJobAfterInvoicePaidToLedger: job_payments insert", insErr);
        return;
      }
    }
  }

  await reconcileJobCustomerPaymentFlags(client, job.id);
  await syncInvoiceCollectionStagesForJob(client, job.id);
  await maybeCompleteAwaitingPaymentJob(client, job.id);
}

/**
 * If job is awaiting_payment and customer + partner financial gates are satisfied (same rules as manual Complete),
 * move to completed & paid.
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
  const partnerPayments = list.filter((p) => p.type === "partner").map((p) => ({ type: "partner" as const, amount: Number(p.amount) }));

  if (!canMarkJobCompletedFinancially(job, customerPayments, partnerPayments).ok) return;

  await client.from("jobs").update({ status: "completed", finance_status: "paid" }).eq("id", jobId);
}
