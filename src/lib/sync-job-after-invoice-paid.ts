import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job } from "@/types/database";
import { customerCollectionsSatisfyBillable, jobBillableRevenue } from "@/lib/job-financials";
import { syncInvoicesFromJobCustomerPayments } from "@/lib/sync-invoices-from-job-payments";
import { reconcileJobCustomerPaymentFlags } from "@/lib/reconcile-job-customer-flags";
import { invoiceAmountPaid } from "@/lib/invoice-balance";
import { isSupabaseMissingColumnError, isJobPaymentsDeletedAtMissing } from "@/lib/supabase-schema-compat";

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
  // Soft-delete aware; fall back to no filter when `deleted_at` isn't on this DB.
  const first = await client
    .from("job_payments")
    .select("amount")
    .eq("linked_invoice_id", invoiceId)
    .is("deleted_at", null);
  let rows: unknown[] | null = first.error ? null : (first.data ?? []);
  if (first.error) {
    if (isSupabaseMissingColumnError(first.error, "linked_invoice_id")) return 0;
    if (isJobPaymentsDeletedAtMissing(first.error)) {
      const retry = await client
        .from("job_payments")
        .select("amount")
        .eq("linked_invoice_id", invoiceId);
      if (retry.error) {
        if (isSupabaseMissingColumnError(retry.error, "linked_invoice_id")) return 0;
        console.error("sumLinkedInvoicePayments", retry.error);
        return 0;
      }
      rows = retry.data ?? [];
    } else {
      console.error("sumLinkedInvoicePayments", first.error);
      return 0;
    }
  }
  return ((rows ?? []) as unknown[]).reduce(
    (s: number, r) => s + Number((r as { amount?: number }).amount ?? 0),
    0,
  );
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

  // Soft-delete aware; fall back to no filter when `deleted_at` isn't on this DB.
  let pays: { type: string; amount: number }[] | null = null;
  const paysFirst = await client
    .from("job_payments")
    .select("type, amount")
    .eq("job_id", job.id)
    .is("deleted_at", null);
  if (!paysFirst.error) pays = (paysFirst.data ?? []) as { type: string; amount: number }[];
  else if (isJobPaymentsDeletedAtMissing(paysFirst.error)) {
    const retry = await client.from("job_payments").select("type, amount").eq("job_id", job.id);
    if (!retry.error) pays = (retry.data ?? []) as { type: string; amount: number }[];
  }
  const list = (pays ?? []) as { type: string; amount: number }[];
  const customerTotal = list
    .filter((p) => p.type === "customer_deposit" || p.type === "customer_final")
    .reduce((s, p) => s + Number(p.amount), 0);

  const billable = jobBillableRevenue(job);
  const jobRemaining = Math.max(0, billable - customerTotal);

  let existingSource: unknown = null;
  let existingSrcErr: unknown = null;
  {
    const first = await client
      .from("job_payments")
      .select("id")
      .eq("source_invoice_id", invoiceId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!first.error) existingSource = first.data;
    else if (isJobPaymentsDeletedAtMissing(first.error)) {
      const retry = await client
        .from("job_payments")
        .select("id")
        .eq("source_invoice_id", invoiceId)
        .maybeSingle();
      if (retry.error) existingSrcErr = retry.error;
      else existingSource = retry.data;
    } else {
      existingSrcErr = first.error;
    }
  }
  if (existingSrcErr && !isSupabaseMissingColumnError(existingSrcErr, "source_invoice_id")) {
    console.error("syncJobAfterInvoicePaidToLedger: existingSource query", existingSrcErr);
    return;
  }
  const hasExistingSource = Boolean(existingSource) && !existingSrcErr;

  const linkedSum = await sumLinkedInvoicePayments(client, invoiceId);
  const invPaid = invoiceAmountPaid(inv as { amount_paid?: number });
  const invoiceNotYetOnJobLedger = Math.max(0, invPaid - linkedSum);
  const payAmt = Math.min(jobRemaining, invoiceNotYetOnJobLedger > EPS ? invoiceNotYetOnJobLedger : jobRemaining);

  if (!hasExistingSource && payAmt > EPS) {
    const paidDate = (inv.paid_date as string) || new Date().toISOString().split("T")[0];
    const paymentRow = {
      job_id: job.id,
      type: "customer_final",
      amount: Math.round(payAmt * 100) / 100,
      payment_date: paidDate,
      note: `${sourceLabel} · ${(inv as { reference?: string }).reference ?? invoiceId}`,
      source_invoice_id: invoiceId,
      linked_invoice_id: invoiceId,
    };
    let { error: insErr } = await client.from("job_payments").insert(paymentRow);

    if (insErr && (insErr as { code?: string }).code !== "23505") {
      const msg = (insErr as { message?: string }).message ?? "";
      const maybeLegacySchema =
        msg.includes("source_invoice_id") ||
        msg.includes("linked_invoice_id") ||
        msg.includes("Could not find the") ||
        msg.includes("does not exist");
      if (maybeLegacySchema) {
        ({ error: insErr } = await client.from("job_payments").insert({
          job_id: paymentRow.job_id,
          type: paymentRow.type,
          amount: paymentRow.amount,
          payment_date: paymentRow.payment_date,
          note: paymentRow.note,
        }));
      }
    }

    if (insErr && (insErr as { code?: string }).code !== "23505") {
      console.error("syncJobAfterInvoicePaidToLedger: job_payments insert", insErr);
    }
  }

  await reconcileJobCustomerPaymentFlags(client, job.id);
  await syncInvoicesFromJobCustomerPayments(client, job.id);
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

  // Soft-delete aware; fall back to no filter when `deleted_at` isn't on this DB.
  let pays: { type: string; amount: number }[] | null = null;
  const first = await client
    .from("job_payments")
    .select("type, amount")
    .eq("job_id", jobId)
    .is("deleted_at", null);
  if (!first.error) pays = (first.data ?? []) as { type: string; amount: number }[];
  else if (isJobPaymentsDeletedAtMissing(first.error)) {
    const retry = await client.from("job_payments").select("type, amount").eq("job_id", jobId);
    if (!retry.error) pays = (retry.data ?? []) as { type: string; amount: number }[];
  }
  const list = (pays ?? []) as { type: string; amount: number }[];
  const customerPayments = list
    .filter((p) => p.type === "customer_deposit" || p.type === "customer_final")
    .map((p) => ({ type: p.type as "customer_deposit" | "customer_final", amount: Number(p.amount) }));

  if (!customerCollectionsSatisfyBillable(job, customerPayments)) {
    // Legacy fallback: if primary linked invoice is already paid, close the job even when
    // job_payments ledger columns are missing and customer rows could not be inserted.
    if (!job.invoice_id) return;
    const { data: inv } = await client
      .from("invoices")
      .select("status")
      .eq("id", job.invoice_id)
      .maybeSingle();
    if ((inv as { status?: string } | null)?.status !== "paid") return;
  }

  await client.from("jobs").update({ status: "completed", finance_status: "paid" }).eq("id", jobId);
}
