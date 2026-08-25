import type { SupabaseClient } from "@supabase/supabase-js";
import type { Invoice, Job } from "@/types/database";
import { allocateCustomerPaymentToSchedule } from "@/lib/allocate-customer-payment";
import { syncInvoicesFromJobCustomerPayments } from "@/lib/sync-invoices-from-job-payments";
import {
  syncJobAfterInvoicePaidToLedger,
  maybeCompleteAwaitingPaymentJob,
} from "@/lib/sync-job-after-invoice-paid";
import { syncInvoiceCollectionStagesForJob } from "@/lib/invoice-collection";
import { isJobPaymentsDeletedAtMissing } from "@/lib/supabase-schema-compat";

const EPS = 0.02;

export type PayLinkCheckoutSession = {
  id: string;
  payment_intent?: string | null;
  amount_total?: number | null;
};

/**
 * Apply a payment from an OS pay-link Checkout Session (`metadata.pay_link = "os"`).
 *
 * Unlike the legacy payment-link path, the charged amount can be PARTIAL (a
 * `?pct=` deposit), so this credits `session.amount_total` instead of marking
 * the invoice fully paid. Job-linked invoices go through the job ledger
 * (`job_payments` + sync), the same path Finance partials use; standalone
 * invoices update `amount_paid` directly.
 *
 * Idempotent per session: the session id is stamped into the ledger note (or
 * `stripe_payment_intent_id` for standalone invoices) and checked on replay,
 * so Stripe webhook retries don't double-credit.
 *
 * Returns true when the invoice ended up fully paid.
 */
export async function applyOsPayLinkPayment(
  admin: SupabaseClient,
  invoiceId: string,
  session: PayLinkCheckoutSession,
): Promise<boolean> {
  const { data: invRow } = await admin.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (!invRow) return false;
  const inv = invRow as Invoice;

  const paidNow = Math.round(Number(session.amount_total ?? 0)) / 100;
  if (paidNow <= EPS) return inv.status === "paid";

  const total = Math.round((Number(inv.amount ?? 0) || 0) * 100) / 100;
  const alreadyPaid = Math.round((Number(inv.amount_paid ?? 0) || 0) * 100) / 100;

  const job = await loadJobForInvoice(admin, inv);

  if (job) {
    const applied = await applyToJobLedger(admin, inv, job, paidNow, session.id);
    if (!applied) {
      // Replay of a session we already credited.
      return inv.status === "paid";
    }
  } else {
    if (session.payment_intent && inv.stripe_payment_intent_id === session.payment_intent) {
      return inv.status === "paid";
    }
    const newPaid = Math.min(total, Math.round((alreadyPaid + paidNow) * 100) / 100);
    const fully = newPaid >= total - EPS;
    await admin
      .from("invoices")
      .update({
        amount_paid: newPaid,
        status: fully ? "paid" : "partially_paid",
        ...(fully ? { paid_date: new Date().toISOString().split("T")[0] } : {}),
      })
      .eq("id", invoiceId);
  }

  const { data: freshRow } = await admin.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  const fresh = (freshRow ?? inv) as Invoice;
  const fullyPaid = fresh.status === "paid";

  await admin
    .from("invoices")
    .update({
      stripe_payment_status: fullyPaid ? "paid" : "pending",
      ...(fullyPaid ? { stripe_paid_at: new Date().toISOString() } : {}),
      ...(session.payment_intent ? { stripe_payment_intent_id: session.payment_intent } : {}),
    })
    .eq("id", invoiceId);

  if (job) {
    if (fullyPaid) {
      await syncJobAfterInvoicePaidToLedger(admin, invoiceId, "Stripe");
    }
    await maybeCompleteAwaitingPaymentJob(admin, job.id);
    await syncInvoiceCollectionStagesForJob(admin, job.id);
  }

  return fullyPaid;
}

async function loadJobForInvoice(admin: SupabaseClient, inv: Invoice): Promise<Job | null> {
  const ref = inv.job_reference?.trim();
  if (!ref) return null;
  const { data } = await admin.from("jobs").select("*").eq("reference", ref).maybeSingle();
  return (data as Job) ?? null;
}

/** Post the charge into `job_payments`; false when this session was already posted. */
async function applyToJobLedger(
  admin: SupabaseClient,
  inv: Invoice,
  job: Job,
  paidNow: number,
  sessionId: string,
): Promise<boolean> {
  const sessionTag = `Stripe checkout ${sessionId}`;

  const { data: existing } = await admin
    .from("job_payments")
    .select("id")
    .eq("job_id", job.id)
    .ilike("note", `%${sessionTag}%`)
    .limit(1);
  if ((existing ?? []).length > 0) return false;

  const pays = await listCustomerPayments(admin, job.id);
  const depositPaid = pays.filter((p) => p.type === "customer_deposit").reduce((s, p) => s + Number(p.amount), 0);
  const finalPaid = pays.filter((p) => p.type === "customer_final").reduce((s, p) => s + Number(p.amount), 0);

  const chunks = allocateCustomerPaymentToSchedule(job, depositPaid, finalPaid, paidNow);
  const rows = (chunks.length > 0 ? chunks : [{ type: "customer_final" as const, amount: paidNow }]).map((ch) => ({
    job_id: job.id,
    type: ch.type,
    amount: ch.amount,
    payment_date: new Date().toISOString().split("T")[0],
    note: `${sessionTag} · ${inv.reference}`,
    payment_method: "stripe",
    linked_invoice_id: inv.id,
  }));

  const { error } = await admin.from("job_payments").insert(rows);
  if (error) {
    console.error("applyOsPayLinkPayment: job_payments insert failed", inv.id, error);
    return false;
  }

  await syncInvoicesFromJobCustomerPayments(admin, job.id);
  return true;
}

async function listCustomerPayments(
  admin: SupabaseClient,
  jobId: string,
): Promise<{ type: string; amount: number }[]> {
  // Soft-delete aware; fall back to no filter when `deleted_at` isn't on this DB.
  const first = await admin
    .from("job_payments")
    .select("type, amount")
    .eq("job_id", jobId)
    .is("deleted_at", null);
  if (!first.error) return (first.data ?? []) as { type: string; amount: number }[];
  if (isJobPaymentsDeletedAtMissing(first.error)) {
    const retry = await admin.from("job_payments").select("type, amount").eq("job_id", jobId);
    if (!retry.error) return (retry.data ?? []) as { type: string; amount: number }[];
  }
  console.error("applyOsPayLinkPayment: job_payments read failed", jobId, first.error);
  return [];
}
