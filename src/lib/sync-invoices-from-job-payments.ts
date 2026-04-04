import type { SupabaseClient } from "@supabase/supabase-js";
import type { Invoice, InvoiceCollectionStage, InvoiceStatus, Job } from "@/types/database";
import { inferInvoiceKind, deriveCollectionStageForInvoice } from "@/lib/invoice-collection";
import { isSupabaseMissingColumnError } from "@/lib/supabase-schema-compat";

const EPS = 0.02;

function computeStatus(inv: Invoice, amountPaid: number, amount: number): InvoiceStatus {
  if (inv.status === "draft" && amountPaid <= EPS) return "draft";
  if (inv.status === "cancelled") return "cancelled";
  if (amountPaid >= amount - EPS) return "paid";
  if (amountPaid > EPS) return "partially_paid";
  const dueRaw = inv.due_date;
  if (dueRaw && typeof dueRaw === "string") {
    try {
      const due = new Date(`${dueRaw.slice(0, 10)}T23:59:59`);
      if (!Number.isNaN(due.getTime()) && due < new Date()) return "overdue";
    } catch {
      /* ignore */
    }
  }
  return "pending";
}

async function sumLinkedCustomerPayments(client: SupabaseClient, invoiceId: string): Promise<number> {
  const { data: rows, error } = await client
    .from("job_payments")
    .select("amount")
    .eq("linked_invoice_id", invoiceId)
    .in("type", ["customer_deposit", "customer_final"])
    .is("deleted_at", null);
  if (error && isSupabaseMissingColumnError(error, "linked_invoice_id")) return 0;
  if (error) {
    console.error("sumLinkedCustomerPayments", error);
    return 0;
  }
  return Math.round((rows ?? []).reduce((s, r) => s + Number((r as { amount?: number }).amount ?? 0), 0) * 100) / 100;
}

async function latestLinkedPaymentDate(client: SupabaseClient, invoiceId: string): Promise<string | null> {
  const { data: rows, error } = await client
    .from("job_payments")
    .select("payment_date")
    .eq("linked_invoice_id", invoiceId)
    .in("type", ["customer_deposit", "customer_final"])
    .is("deleted_at", null);
  if (error) {
    if (isSupabaseMissingColumnError(error, "linked_invoice_id")) return null;
    console.error("latestLinkedPaymentDate", error);
    return null;
  }
  let latest: string | null = null;
  for (const r of rows ?? []) {
    const d = (r as { payment_date?: string }).payment_date?.slice(0, 10);
    if (d && (!latest || d > latest)) latest = d;
  }
  return latest;
}

async function getJobIdsSharingInvoice(
  client: SupabaseClient,
  invoiceId: string,
  jobRefFallback?: string | null,
): Promise<string[]> {
  const { data: jobs } = await client.from("jobs").select("id").eq("invoice_id", invoiceId).is("deleted_at", null);
  const ids = (jobs ?? []).map((j) => (j as { id: string }).id);
  if (ids.length > 0) return ids;
  if (jobRefFallback?.trim()) {
    const { data: j2 } = await client
      .from("jobs")
      .select("id")
      .eq("reference", jobRefFallback.trim())
      .is("deleted_at", null)
      .maybeSingle();
    if (j2?.id) return [(j2 as { id: string }).id];
  }
  return [];
}

async function applyInvoicePaymentUpdates(
  client: SupabaseClient,
  inv: Invoice,
  job: Job,
  allocated: number,
  latestDate: string | null,
): Promise<void> {
  const amt = Number(inv.amount ?? 0);
  const nextStatus = computeStatus(inv, allocated, amt);
  const full = nextStatus === "paid";
  const partial = nextStatus === "partially_paid";

  const nextStage: InvoiceCollectionStage = deriveCollectionStageForInvoice(job, {
    invoice_kind: inv.invoice_kind === "weekly_batch" ? "combined" : inv.invoice_kind,
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
    const { error: upErr } = await client.from("invoices").update(updates).eq("id", inv.id);
    if (upErr) {
      const errStr = JSON.stringify(upErr).toLowerCase();
      if (errStr.includes("last_payment_date") && "last_payment_date" in updates) {
        const { last_payment_date: _omit, ...rest } = updates as Record<string, unknown>;
        const { error: err2 } = await client.from("invoices").update(rest).eq("id", inv.id);
        if (err2) console.error("syncInvoicesFromJobCustomerPayments: invoice update", inv.id, err2);
      } else {
        console.error("syncInvoicesFromJobCustomerPayments: invoice update", inv.id, upErr);
      }
    }
  }
}

async function syncSingleJobInvoice(client: SupabaseClient, inv: Invoice, job: Job): Promise<void> {
  const linkedSum = await sumLinkedCustomerPayments(client, inv.id);
  const amt = Number(inv.amount ?? 0);

  if (linkedSum > EPS) {
    const allocated = Math.min(linkedSum, amt);
    const linkedLatest = await latestLinkedPaymentDate(client, inv.id);
    await applyInvoicePaymentUpdates(client, inv, job, allocated, linkedLatest);
    return;
  }

  const { data: pays } = await client
    .from("job_payments")
    .select("type, amount, payment_date")
    .eq("job_id", job.id)
    .is("deleted_at", null);

  const list = (pays ?? []) as { type: string; amount: number; payment_date?: string }[];
  const depSum = list.filter((p) => p.type === "customer_deposit").reduce((s, p) => s + Number(p.amount), 0);
  const finSum = list.filter((p) => p.type === "customer_final").reduce((s, p) => s + Number(p.amount), 0);
  let latestDate: string | null = null;
  for (const p of list.filter((x) => x.type === "customer_deposit" || x.type === "customer_final")) {
    const d = p.payment_date?.slice(0, 10);
    if (d && (!latestDate || d > latestDate)) latestDate = d;
  }

  const kind = inferInvoiceKind(job, inv);
  let allocated = 0;
  if (kind === "deposit") {
    allocated = Math.min(depSum, amt);
  } else if (kind === "final") {
    allocated = Math.min(finSum, amt);
  } else {
    allocated = Math.min(depSum + finSum, amt);
  }
  allocated = Math.round(allocated * 100) / 100;

  await applyInvoicePaymentUpdates(client, inv, job, allocated, latestDate);
}

async function syncWeeklyBatchInvoice(client: SupabaseClient, inv: Invoice, triggerJob: Job): Promise<void> {
  const linkedDirect = await sumLinkedCustomerPayments(client, inv.id);
  const amt = Number(inv.amount ?? 0);
  if (linkedDirect > EPS) {
    const allocated = Math.min(linkedDirect, amt);
    const linkedLatest = await latestLinkedPaymentDate(client, inv.id);
    await applyInvoicePaymentUpdates(client, inv, triggerJob, allocated, linkedLatest);
    return;
  }

  const jobIds = await getJobIdsSharingInvoice(client, inv.id, inv.job_reference);
  if (jobIds.length === 0) return;

  let depSum = 0;
  let finSum = 0;
  let latestDate: string | null = null;
  for (const jid of jobIds) {
    const { data: pays } = await client
      .from("job_payments")
      .select("type, amount, payment_date")
      .eq("job_id", jid)
      .is("deleted_at", null);
    const list = (pays ?? []) as { type: string; amount: number; payment_date?: string }[];
    for (const p of list) {
      if (p.type === "customer_deposit") depSum += Number(p.amount);
      if (p.type === "customer_final") finSum += Number(p.amount);
      if (p.type === "customer_deposit" || p.type === "customer_final") {
        const d = p.payment_date?.slice(0, 10);
        if (d && (!latestDate || d > latestDate)) latestDate = d;
      }
    }
  }

  const pool = Math.round((depSum + finSum) * 100) / 100;
  const allocated = Math.min(pool, amt);

  await applyInvoicePaymentUpdates(client, inv, triggerJob, allocated, latestDate);
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

  const { data: byRef } = await client
    .from("invoices")
    .select("*")
    .eq("job_reference", job.reference)
    .is("deleted_at", null);
  const rows: Invoice[] = [...((byRef ?? []) as Invoice[])];
  if (job.invoice_id) {
    const { data: primary } = await client.from("invoices").select("*").eq("id", job.invoice_id).is("deleted_at", null).maybeSingle();
    const p = primary as Invoice | null;
    if (p && !rows.some((r) => r.id === p.id)) rows.unshift(p);
  }
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  if (!unique.length) return;

  for (const inv of unique) {
    if (inv.collection_stage_locked) continue;
    if (inv.status === "cancelled") continue;

    if (inv.invoice_kind === "weekly_batch") {
      await syncWeeklyBatchInvoice(client, inv, job);
    } else {
      await syncSingleJobInvoice(client, inv, job);
    }
  }
}
