import type { SupabaseClient } from "@supabase/supabase-js";
import type { Invoice } from "@/types/database";
import { isJobForcePaid } from "@/lib/job-force-paid";
import { reconcileJobCustomerPaymentFlags } from "@/lib/reconcile-job-customer-flags";
import { syncInvoicesFromJobCustomerPayments } from "@/lib/sync-invoices-from-job-payments";
import { maybeCompleteAwaitingPaymentJob } from "@/lib/sync-job-after-invoice-paid";
import { isSupabaseMissingColumnError } from "@/lib/supabase-schema-compat";

/**
 * Some DBs don't have `deleted_at` on `job_payments`. Instead of a probe (which
 * can false-positive through a cache layer), try the soft-delete aware query
 * first and fall back to the no-filter version on the specific PostgREST
 * "undefined column" error (42703). Returns the matching ids.
 */
function isUndefinedDeletedAt(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  const msg = (err as { message?: string } | null)?.message ?? "";
  if (code === "42703") return true;
  if (msg.includes("deleted_at")) return true;
  return isSupabaseMissingColumnError(err, "deleted_at");
}

async function findJobPaymentIds(
  client: SupabaseClient,
  filter: "linked_invoice_id" | "source_invoice_id",
  invoiceId: string,
): Promise<{ ids: string[]; hasDeletedAt: boolean }> {
  // First attempt: soft-delete aware (filters out already-deleted rows).
  const aware = await client
    .from("job_payments")
    .select("id")
    .eq(filter, invoiceId)
    .is("deleted_at", null);
  if (!aware.error) {
    const ids = (aware.data ?? []).map((r) => (r as { id: string }).id);
    return { ids, hasDeletedAt: true };
  }
  // Column missing on this DB → retry without the filter and treat as hard-delete.
  if (isUndefinedDeletedAt(aware.error)) {
    const raw = await client.from("job_payments").select("id").eq(filter, invoiceId);
    if (raw.error) {
      if (filter === "source_invoice_id" && isSupabaseMissingColumnError(raw.error, "source_invoice_id")) {
        return { ids: [], hasDeletedAt: false };
      }
      throw raw.error;
    }
    const ids = (raw.data ?? []).map((r) => (r as { id: string }).id);
    return { ids, hasDeletedAt: false };
  }
  // source_invoice_id may itself not exist on older DBs — treat as empty result.
  if (filter === "source_invoice_id" && isSupabaseMissingColumnError(aware.error, "source_invoice_id")) {
    return { ids: [], hasDeletedAt: true };
  }
  throw aware.error;
}

/**
 * Reset an invoice from paid/partially_paid to pending: clear amount_paid, remove job_payments
 * tied to this invoice, optionally move a completed job back to awaiting_payment.
 */
export async function reopenInvoiceToPending(client: SupabaseClient, invoice: Invoice): Promise<void> {
  if (invoice.status !== "paid" && invoice.status !== "partially_paid") return;

  const now = new Date().toISOString();

  /** Remove the matching ids: soft-delete if the column exists, hard-delete otherwise. */
  const clearIds = async (ids: string[], hasDeletedAt: boolean) => {
    if (ids.length === 0) return;
    if (hasDeletedAt) {
      await client.from("job_payments").update({ deleted_at: now }).in("id", ids);
    } else {
      await client.from("job_payments").delete().in("id", ids);
    }
  };

  // Linked-invoice rows — payments recorded directly against this invoice.
  const byLink = await findJobPaymentIds(client, "linked_invoice_id", invoice.id);
  await clearIds(byLink.ids, byLink.hasDeletedAt);

  // Source-invoice rows — payments generated from this invoice (legacy column).
  const bySource = await findJobPaymentIds(client, "source_invoice_id", invoice.id);
  await clearIds(bySource.ids, bySource.hasDeletedAt);

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
