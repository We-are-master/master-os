import type { SupabaseClient } from "@supabase/supabase-js";
import type { Invoice, InvoiceCollectionStage, Job } from "@/types/database";
import { jobCustomerBillableRevenueForCollections } from "@/lib/job-financials";

function nearEqual(a: number, b: number, eps = 0.02): boolean {
  return Math.abs(a - b) <= eps;
}

export function inferInvoiceKind(job: Job, inv: Pick<Invoice, "invoice_kind" | "amount">): NonNullable<Invoice["invoice_kind"]> {
  if (inv.invoice_kind === "weekly_batch") return "combined";
  if (inv.invoice_kind && inv.invoice_kind !== "other") return inv.invoice_kind;
  const dep = Number(job.customer_deposit ?? 0);
  const fin = Number(job.customer_final_payment ?? 0);
  const amt = Number(inv.amount ?? 0);
  const ticketPlusExtras = Number(job.client_price ?? 0) + Number(job.extras_amount ?? 0);
  const billableForCollections = jobCustomerBillableRevenueForCollections(job);
  if (dep > 0 && nearEqual(amt, dep)) return "deposit";
  if (fin > 0 && nearEqual(amt, fin)) return "final";
  if (
    nearEqual(amt, billableForCollections) ||
    nearEqual(amt, ticketPlusExtras) ||
    nearEqual(amt, dep + fin)
  ) {
    return "combined";
  }
  return "other";
}

/**
 * Derive collection stage from job payment flags (unless ops locked the invoice row).
 */
export function deriveCollectionStageForInvoice(
  job: Job,
  inv: Pick<Invoice, "amount" | "invoice_kind" | "status">
): InvoiceCollectionStage {
  if (inv.status === "paid") return "completed";

  const kind = inferInvoiceKind(job, inv);

  if (kind === "deposit") {
    if (job.customer_deposit_paid) return "deposit_collected";
    return "awaiting_deposit";
  }

  if (kind === "final") {
    if (job.customer_final_paid) return "completed";
    const dep = Number(job.customer_deposit ?? 0);
    if (dep > 0.01 && !job.customer_deposit_paid) return "awaiting_deposit";
    return "awaiting_final";
  }

  if (kind === "combined") {
    if (job.customer_final_paid) return "completed";
    if (job.customer_deposit_paid && Number(job.customer_final_payment ?? 0) > 0.01) return "awaiting_final";
    if (Number(job.customer_deposit ?? 0) > 0.01 && !job.customer_deposit_paid) return "awaiting_deposit";
    return "awaiting_final";
  }

  // other: best-effort from flags
  if (job.customer_final_paid) return "completed";
  if (job.customer_deposit_paid && Number(job.customer_final_payment ?? 0) > 0.01) return "awaiting_final";
  if (Number(job.customer_deposit ?? 0) > 0.01 && !job.customer_deposit_paid) return "awaiting_deposit";
  return "awaiting_final";
}

export const COLLECTION_STAGE_LABELS: Record<InvoiceCollectionStage, string> = {
  awaiting_deposit: "Awaiting deposit",
  deposit_collected: "Deposit collected",
  awaiting_final: "Awaiting final payment",
  completed: "Paid in full",
};

/** Push collection_stage from job state to all invoices for that job (respects lock). */
export async function syncInvoiceCollectionStagesForJob(
  client: SupabaseClient,
  jobId: string
): Promise<void> {
  const { data: job, error: jobErr } = await client.from("jobs").select("*").eq("id", jobId).maybeSingle();
  if (jobErr || !job) return;

  const { data: invs, error: invErr } = await client
    .from("invoices")
    .select("*")
    .eq("job_reference", job.reference)
    .is("deleted_at", null);
  if (invErr || !invs?.length) return;

  for (const inv of invs as Invoice[]) {
    if (inv.collection_stage_locked) continue;
    const next = deriveCollectionStageForInvoice(job as Job, inv);
    if (next !== inv.collection_stage) {
      await client.from("invoices").update({ collection_stage: next }).eq("id", inv.id);
    }
  }
}
