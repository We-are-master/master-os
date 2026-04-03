import type { SupabaseClient } from "@supabase/supabase-js";
import type { Invoice, InvoiceCollectionStage, InvoiceStatus, Job } from "@/types/database";
import { inferInvoiceKind, deriveCollectionStageForInvoice } from "@/lib/invoice-collection";

const EPS = 0.02;

function computeStatus(inv: Invoice, amountPaid: number, amount: number): InvoiceStatus {
  if (inv.status === "cancelled") return "cancelled";
  if (amountPaid >= amount - EPS) return "paid";
  if (amountPaid > EPS) return "partially_paid";
  try {
    const due = new Date(`${inv.due_date.slice(0, 10)}T23:59:59`);
    if (due < new Date()) return "overdue";
  } catch {
    /* ignore */
  }
  return "pending";
}

/**
 * After customer rows are posted on `job_payments`, align linked `invoices`:
 * `amount_paid`, `status` (paid / partially_paid / pending / overdue), `paid_date`, `last_payment_date`,
 * `collection_stage` — so Finance + dashboard match the job financial summary.
 */
export async function syncInvoicesFromJobCustomerPayments(client: SupabaseClient, jobId: string): Promise<void> {
  const { data: jobRow, error: jErr } = await client.from("jobs").select("*").eq("id", jobId).maybeSingle();
  if (jErr || !jobRow) return;
  const job = jobRow as Job;

  const { data: pays } = await client
    .from("job_payments")
    .select("type, amount, payment_date")
    .eq("job_id", jobId)
    .is("deleted_at", null);

  const list = (pays ?? []) as { type: string; amount: number; payment_date?: string }[];
  const depSum = list.filter((p) => p.type === "customer_deposit").reduce((s, p) => s + Number(p.amount), 0);
  const finSum = list.filter((p) => p.type === "customer_final").reduce((s, p) => s + Number(p.amount), 0);
  let latestDate: string | null = null;
  for (const p of list.filter((x) => x.type === "customer_deposit" || x.type === "customer_final")) {
    const d = p.payment_date?.slice(0, 10);
    if (d && (!latestDate || d > latestDate)) latestDate = d;
  }

  const { data: invs } = await client
    .from("invoices")
    .select("*")
    .eq("job_reference", job.reference)
    .is("deleted_at", null);
  if (!invs?.length) return;

  for (const inv of invs as Invoice[]) {
    if (inv.collection_stage_locked) continue;
    if (inv.status === "cancelled") continue;

    const kind = inferInvoiceKind(job, inv);
    const amt = Number(inv.amount ?? 0);
    let allocated = 0;
    if (kind === "deposit") {
      allocated = Math.min(depSum, amt);
    } else if (kind === "final") {
      allocated = Math.min(finSum, amt);
    } else {
      allocated = Math.min(depSum + finSum, amt);
    }
    allocated = Math.round(allocated * 100) / 100;

    const nextStatus = computeStatus(inv, allocated, amt);
    const full = nextStatus === "paid";
    const partial = nextStatus === "partially_paid";

    const nextStage: InvoiceCollectionStage = deriveCollectionStageForInvoice(job, {
      invoice_kind: inv.invoice_kind,
      amount: inv.amount,
      status: nextStatus,
    });

    const updates: Record<string, unknown> = {
      amount_paid: allocated,
      status: nextStatus,
      collection_stage: nextStage,
    };

    if (full) {
      updates.paid_date = latestDate ?? new Date().toISOString().slice(0, 10);
      updates.last_payment_date = updates.paid_date;
    } else if (partial) {
      updates.paid_date = null;
      updates.last_payment_date = latestDate;
    } else {
      updates.paid_date = null;
      updates.last_payment_date = null;
    }

    const prevPaid = Number(inv.amount_paid ?? 0);
    const prevStatus = inv.status;
    if (
      Math.abs(prevPaid - allocated) > EPS ||
      prevStatus !== nextStatus ||
      (inv.collection_stage ?? "") !== (nextStage ?? "")
    ) {
      await client.from("invoices").update(updates).eq("id", inv.id);
    }
  }
}
