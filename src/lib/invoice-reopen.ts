import type { SupabaseClient } from "@supabase/supabase-js";
import type { Invoice } from "@/types/database";
import { isJobForcePaid } from "@/lib/job-force-paid";
import { reconcileJobCustomerPaymentFlags } from "@/lib/reconcile-job-customer-flags";
import { syncInvoiceCollectionStagesForJob } from "@/lib/invoice-collection";

/**
 * Reset an invoice from paid/partially_paid to pending: clear amount_paid, remove job_payments
 * tied to this invoice, optionally move a completed job back to awaiting_payment.
 */
export async function reopenInvoiceToPending(client: SupabaseClient, invoice: Invoice): Promise<void> {
  if (invoice.status !== "paid" && invoice.status !== "partially_paid") return;

  const { data: byLink, error: e1 } = await client
    .from("job_payments")
    .select("id")
    .eq("linked_invoice_id", invoice.id)
    .is("deleted_at", null);
  if (e1) throw e1;
  const now = new Date().toISOString();
  for (const row of byLink ?? []) {
    await client.from("job_payments").update({ deleted_at: now }).eq("id", (row as { id: string }).id);
  }

  const { data: bySource, error: e2 } = await client
    .from("job_payments")
    .select("id")
    .eq("source_invoice_id", invoice.id)
    .is("deleted_at", null);
  if (e2) throw e2;
  for (const row of bySource ?? []) {
    await client.from("job_payments").update({ deleted_at: now }).eq("id", (row as { id: string }).id);
  }

  const { error: uErr } = await client
    .from("invoices")
    .update({
      status: "pending",
      paid_date: null,
      amount_paid: 0,
      stripe_payment_status: "none",
      stripe_payment_link_id: null,
      stripe_payment_link_url: null,
      stripe_paid_at: null,
    })
    .eq("id", invoice.id);
  if (uErr) throw uErr;

  const ref = invoice.job_reference?.trim();
  if (!ref) return;

  const { data: jobRow, error: jErr } = await client.from("jobs").select("*").eq("reference", ref).maybeSingle();
  if (jErr || !jobRow) return;

  const job = jobRow as import("@/types/database").Job;
  await reconcileJobCustomerPaymentFlags(client, job.id);
  await syncInvoiceCollectionStagesForJob(client, job.id);

  if (job.status === "completed" && !isJobForcePaid(job.internal_notes)) {
    await client
      .from("jobs")
      .update({ status: "awaiting_payment", finance_status: "unpaid" })
      .eq("id", job.id);
  }
}
