import type { SupabaseClient } from "@supabase/supabase-js";
import { syncInvoiceCollectionStagesForJob } from "@/lib/invoice-collection";

function nearEqual(a: number, b: number, eps = 0.02): boolean {
  return Math.abs(a - b) <= eps;
}

/**
 * After an invoice is marked paid (Stripe webhook or check-status), align the job:
 * - Sets customer_deposit_paid / customer_final_paid when appropriate
 * - Inserts a job_payments row (deduped by source_invoice_id) so the job ledger matches Stripe
 */
export async function syncJobAfterStripeInvoicePaid(
  admin: SupabaseClient,
  invoiceId: string
): Promise<void> {
  const { data: inv, error: invErr } = await admin.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (invErr || !inv) return;

  const { data: existingPay } = await admin
    .from("job_payments")
    .select("id")
    .eq("source_invoice_id", invoiceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (existingPay) return;

  const { data: jobByInvoice } = await admin.from("jobs").select("*").eq("invoice_id", invoiceId).maybeSingle();
  let job = jobByInvoice;
  if (!job && inv.job_reference) {
    const { data: jobByRef } = await admin.from("jobs").select("*").eq("reference", inv.job_reference).maybeSingle();
    job = jobByRef;
  }
  if (!job) return;

  const amt = Number(inv.amount ?? 0);
  const dep = Number(job.customer_deposit ?? 0);
  const fin = Number(job.customer_final_payment ?? 0);
  const paidDate = (inv.paid_date as string) || new Date().toISOString().split("T")[0];

  type PayType = "customer_deposit" | "customer_final";
  let paymentType: PayType = "customer_deposit";
  const updates: Record<string, boolean> = {};

  const isPrimaryLinked = job.invoice_id === invoiceId;

  if (nearEqual(amt, dep + fin) && dep > 0 && fin > 0) {
    paymentType = "customer_final";
    updates.customer_deposit_paid = true;
    updates.customer_final_paid = true;
  } else if (isPrimaryLinked) {
    if (dep > 0.01) {
      paymentType = "customer_deposit";
      updates.customer_deposit_paid = true;
    } else {
      paymentType = "customer_final";
      updates.customer_final_paid = true;
    }
  } else {
    if (dep > 0.01 && nearEqual(amt, dep) && !job.customer_deposit_paid) {
      paymentType = "customer_deposit";
      updates.customer_deposit_paid = true;
    } else {
      paymentType = "customer_final";
      updates.customer_final_paid = true;
    }
  }

  const { error: insErr } = await admin.from("job_payments").insert({
    job_id: job.id,
    type: paymentType,
    amount: amt,
    payment_date: paidDate,
    note: `Stripe · ${inv.reference}`,
    source_invoice_id: invoiceId,
  });

  if (insErr) {
    // Concurrent webhooks / double events
    if ((insErr as { code?: string }).code === "23505") return;
    console.error("stripe-job-sync: job_payments insert", insErr);
    return;
  }

  if (Object.keys(updates).length > 0) {
    await admin.from("jobs").update(updates).eq("id", job.id);
  }

  await syncInvoiceCollectionStagesForJob(admin, job.id);
}
