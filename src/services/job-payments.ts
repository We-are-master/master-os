import { getSupabase, softDeleteById } from "./base";
import type { JobPayment, JobPaymentMethod, JobPaymentType } from "@/types/database";
import {
  isCustomerExtraChargePaymentNote,
  isPartnerExtraPayoutPaymentNote,
  reverseCustomerExtraPatch,
  reversePartnerExtraPatch,
} from "@/lib/job-extra-charges";
import { bumpLinkedInvoiceAmountsToJobSchedule } from "@/lib/sync-invoice-amount-from-job";
import { reconcileJobCustomerPaymentFlags } from "@/lib/reconcile-job-customer-flags";
import { syncInvoicesFromJobCustomerPayments } from "@/lib/sync-invoices-from-job-payments";
import { maybeCompleteAwaitingPaymentJob } from "@/lib/sync-job-after-invoice-paid";
import { isSupabaseMissingColumnError } from "@/lib/supabase-schema-compat";
import { getJob, updateJob } from "./jobs";
import { syncSelfBillAfterJobChange } from "./self-bills";

export interface CreateJobPaymentInput {
  job_id: string;
  type: JobPaymentType;
  amount: number;
  payment_date: string;
  note?: string;
  payment_method?: JobPaymentMethod;
  bank_reference?: string;
  created_by?: string;
  source_invoice_id?: string | null;
  linked_invoice_id?: string | null;
}

export async function listJobPayments(jobId: string, type?: JobPaymentType): Promise<JobPayment[]> {
  const supabase = getSupabase();
  let query = supabase
    .from("job_payments")
    .select("*")
    .eq("job_id", jobId)
    .is("deleted_at", null)
    .order("payment_date", { ascending: false });

  if (type) query = query.eq("type", type);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as JobPayment[];
}

export async function createJobPayment(input: CreateJobPaymentInput): Promise<JobPayment> {
  const supabase = getSupabase();
  const base: Record<string, unknown> = {
    job_id: input.job_id,
    type: input.type,
    amount: input.amount,
    payment_date: input.payment_date,
    note: input.note ?? null,
    payment_method: input.payment_method ?? "bank_transfer",
    bank_reference: input.bank_reference ?? null,
    created_by: input.created_by ?? null,
  };
  let payload: Record<string, unknown> = { ...base };
  if (input.source_invoice_id) payload.source_invoice_id = input.source_invoice_id;
  if (input.linked_invoice_id) payload.linked_invoice_id = input.linked_invoice_id;

  let { data, error } = await supabase.from("job_payments").insert(payload).select().single();
  if (error && isSupabaseMissingColumnError(error, "linked_invoice_id") && "linked_invoice_id" in payload) {
    const { linked_invoice_id: _, ...rest } = payload;
    payload = rest;
    ({ data, error } = await supabase.from("job_payments").insert(payload).select().single());
  }
  if (error && isSupabaseMissingColumnError(error, "source_invoice_id") && "source_invoice_id" in payload) {
    const { source_invoice_id: _, ...rest } = payload;
    ({ data, error } = await supabase.from("job_payments").insert(rest).select().single());
  }

  if (error) throw error;

  await reconcileJobCustomerPaymentFlags(supabase, input.job_id);
  await syncInvoicesFromJobCustomerPayments(supabase, input.job_id);
  await maybeCompleteAwaitingPaymentJob(supabase, input.job_id);

  return data as JobPayment;
}

export async function deleteJobPayment(id: string): Promise<void> {
  const supabase = getSupabase();
  const { data: row, error: selErr } = await supabase
    .from("job_payments")
    .select("job_id, type, amount, note")
    .eq("id", id)
    .maybeSingle();
  if (selErr) throw selErr;

  const jobId = (row as { job_id?: string } | null)?.job_id;
  const payType = (row as { type?: string } | null)?.type;
  const payAmount = Number((row as { amount?: unknown } | null)?.amount) || 0;
  const payNote = (row as { note?: string | null } | null)?.note ?? null;

  if (jobId && payType === "customer_final" && isCustomerExtraChargePaymentNote(payNote)) {
    const job = await getJob(jobId);
    if (job) {
      const patch = reverseCustomerExtraPatch(job, payAmount, "extras");
      const updated = await updateJob(jobId, patch);
      await bumpLinkedInvoiceAmountsToJobSchedule(updated);
      await syncSelfBillAfterJobChange(updated);
    }
  } else if (jobId && payType === "partner" && isPartnerExtraPayoutPaymentNote(payNote)) {
    const job = await getJob(jobId);
    if (job) {
      const patch = reversePartnerExtraPatch(job, payAmount, "partner_cost");
      const updated = await updateJob(jobId, patch);
      await syncSelfBillAfterJobChange(updated);
    }
  }

  await softDeleteById("job_payments", id);
  if (jobId) {
    await reconcileJobCustomerPaymentFlags(supabase, jobId);
    await syncInvoicesFromJobCustomerPayments(supabase, jobId);
    await maybeCompleteAwaitingPaymentJob(supabase, jobId);
  }
}

const CUSTOMER_COLLECTION_TYPES = ["customer_deposit", "customer_final"] as const;

/** Sum of customer_deposit + customer_final rows per job (matches job detail payment ledger). */
export async function sumCustomerCollectionsByJobIds(jobIds: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(jobIds.filter(Boolean))];
  if (unique.length === 0) return {};
  const supabase = getSupabase();
  const chunkSize = 200;
  const map: Record<string, number> = {};
  for (let i = 0; i < unique.length; i += chunkSize) {
    const slice = unique.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("job_payments")
      .select("job_id, type, amount")
      .in("job_id", slice)
      .in("type", [...CUSTOMER_COLLECTION_TYPES])
      .is("deleted_at", null);
    if (error) throw error;
    for (const row of data ?? []) {
      const jid = (row as { job_id?: string }).job_id;
      if (!jid) continue;
      const t = (row as { type?: string }).type;
      if (t !== "customer_deposit" && t !== "customer_final") continue;
      map[jid] = (map[jid] ?? 0) + Number((row as { amount?: unknown }).amount ?? 0);
    }
  }
  return map;
}
