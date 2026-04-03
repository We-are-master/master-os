import { createInvoice, updateInvoice } from "./invoices";
import {
  getInvoiceDueDateIsoForClient,
  getPaymentTermsForClient,
  getSourceAccountIdForClient,
} from "./invoice-due-date";
import { isWeeklyConsolidatedTerms } from "@/lib/invoice-payment-terms";
import { getSupabase } from "./base";
import type { Invoice, InvoiceCollectionStage, Job } from "@/types/database";

/** ISO Monday (local calendar) for the week containing `d`. */
export function isoMondayLocal(d: Date): string {
  const dow = d.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + mondayOffset);
  const y = monday.getFullYear();
  const mo = String(monday.getMonth() + 1).padStart(2, "0");
  const dd = String(monday.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dd}`;
}

export type CreateJobInvoicePayload = {
  client_name: string;
  amount: number;
  status: Invoice["status"];
  paid_date?: string;
  invoice_kind: NonNullable<Invoice["invoice_kind"]>;
  collection_stage?: InvoiceCollectionStage;
};

/**
 * Creates a job-linked invoice with due date from the client’s linked account payment terms
 * (Net 7/15/30/60, Due on Receipt, Every N days).
 *
 * When the account uses **Every N days** (7 / 15 / 30), invoices for that account in the same
 * calendar week are consolidated into one row (amounts summed; first job’s reference is kept).
 */
export async function createOrAppendJobInvoice(job: Job, payload: CreateJobInvoicePayload): Promise<Invoice> {
  const terms = await getPaymentTermsForClient(job.client_id ?? null);
  const accountId = await getSourceAccountIdForClient(job.client_id ?? null);
  const ref = job.reference?.trim();
  const due = await getInvoiceDueDateIsoForClient(job.client_id ?? null, new Date());

  if (!ref) {
    return createInvoice({ ...payload, job_reference: job.reference ?? "", due_date: due });
  }

  if (!isWeeklyConsolidatedTerms(terms) || !accountId) {
    return createInvoice({ ...payload, job_reference: ref, due_date: due });
  }

  const weekStart = isoMondayLocal(new Date());
  const supabase = getSupabase();
  const { data: existing, error: lookErr } = await supabase
    .from("invoices")
    .select("*")
    .eq("source_account_id", accountId)
    .eq("billing_week_start", weekStart)
    .is("deleted_at", null)
    .maybeSingle();

  if (lookErr) {
    console.warn("weekly invoice lookup failed", lookErr);
    return createInvoice({ ...payload, job_reference: ref, due_date: due });
  }

  if (existing) {
    const ex = existing as Invoice;
    const nextAmount = Math.round((Number(ex.amount) + payload.amount) * 100) / 100;
    return updateInvoice(ex.id, { amount: nextAmount });
  }

  const base = {
    ...payload,
    invoice_kind: "weekly_batch" as const,
    job_reference: ref,
    due_date: due,
    billing_week_start: weekStart,
    source_account_id: accountId,
  };

  try {
    return await createInvoice(base as Parameters<typeof createInvoice>[0]);
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (msg.includes("billing_week") || msg.includes("source_account") || msg.includes("weekly_batch")) {
      return createInvoice({ ...payload, job_reference: ref, due_date: due, invoice_kind: "combined" });
    }
    throw e;
  }
}
