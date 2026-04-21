import type { SupabaseClient } from "@supabase/supabase-js";
import type { Invoice } from "@/types/database";
import { isJobForcePaid } from "@/lib/job-force-paid";
import { reconcileJobCustomerPaymentFlags } from "@/lib/reconcile-job-customer-flags";
import { syncInvoicesFromJobCustomerPayments } from "@/lib/sync-invoices-from-job-payments";
import { maybeCompleteAwaitingPaymentJob } from "@/lib/sync-job-after-invoice-paid";
import { isSupabaseMissingColumnError } from "@/lib/supabase-schema-compat";

/**
 * Older DBs don't have a `deleted_at` column on `job_payments`. PostgREST
 * surfaces this as error 42703 / "undefined column". We probe once per call
 * with a tiny read so the rest of the reopen flow knows whether to soft-delete
 * (update deleted_at) or hard-delete the matching payments.
 */
async function probeJobPaymentsDeletedAt(client: SupabaseClient): Promise<boolean> {
  const { error } = await client.from("job_payments").select("deleted_at").limit(1);
  if (!error) return true;
  const code = (error as { code?: string }).code;
  const msg = (error as { message?: string }).message ?? "";
  if (code === "42703" || msg.includes("deleted_at") || isSupabaseMissingColumnError(error, "deleted_at")) {
    return false;
  }
  // Any unrelated error — assume the column exists and let the caller surface it.
  return true;
}

/**
 * Reset an invoice from paid/partially_paid to pending: clear amount_paid, remove job_payments
 * tied to this invoice, optionally move a completed job back to awaiting_payment.
 */
export async function reopenInvoiceToPending(client: SupabaseClient, invoice: Invoice): Promise<void> {
  if (invoice.status !== "paid" && invoice.status !== "partially_paid") return;

  const hasDeletedAt = await probeJobPaymentsDeletedAt(client);
  const now = new Date().toISOString();

  // Linked-invoice rows — payments recorded directly against this invoice.
  const linkQuery = client.from("job_payments").select("id").eq("linked_invoice_id", invoice.id);
  const { data: byLink, error: e1 } = hasDeletedAt ? await linkQuery.is("deleted_at", null) : await linkQuery;
  if (e1) throw e1;
  for (const row of byLink ?? []) {
    const id = (row as { id: string }).id;
    if (hasDeletedAt) {
      await client.from("job_payments").update({ deleted_at: now }).eq("id", id);
    } else {
      await client.from("job_payments").delete().eq("id", id);
    }
  }

  // Source-invoice rows — payments generated from this invoice (legacy column).
  const sourceQuery = client.from("job_payments").select("id").eq("source_invoice_id", invoice.id);
  const { data: bySource, error: e2 } = hasDeletedAt ? await sourceQuery.is("deleted_at", null) : await sourceQuery;
  if (e2 && !isSupabaseMissingColumnError(e2, "source_invoice_id")) throw e2;
  for (const row of bySource ?? []) {
    const id = (row as { id: string }).id;
    if (hasDeletedAt) {
      await client.from("job_payments").update({ deleted_at: now }).eq("id", id);
    } else {
      await client.from("job_payments").delete().eq("id", id);
    }
  }

  const { error: uErr } = await client
    .from("invoices")
    .update({
      status: "pending",
      paid_date: null,
      last_payment_date: null,
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
  await syncInvoicesFromJobCustomerPayments(client, job.id);
  await maybeCompleteAwaitingPaymentJob(client, job.id);

  if (job.status === "completed" && !isJobForcePaid(job.internal_notes)) {
    await client
      .from("jobs")
      .update({ status: "awaiting_payment", finance_status: "unpaid" })
      .eq("id", job.id);
  }
}
