import { getSupabase, softDeleteById } from "./base";
import type { JobPayment, JobPaymentMethod, JobPaymentType } from "@/types/database";
import { reconcileJobCustomerPaymentFlags } from "@/lib/reconcile-job-customer-flags";
import { syncInvoiceCollectionStagesForJob } from "@/lib/invoice-collection";

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
  const { data, error } = await supabase
    .from("job_payments")
    .insert({
      job_id: input.job_id,
      type: input.type,
      amount: input.amount,
      payment_date: input.payment_date,
      note: input.note ?? null,
      payment_method: input.payment_method ?? "bank_transfer",
      bank_reference: input.bank_reference ?? null,
      created_by: input.created_by ?? null,
      source_invoice_id: input.source_invoice_id ?? null,
      linked_invoice_id: input.linked_invoice_id ?? null,
    })
    .select()
    .single();

  if (error) throw error;

  await reconcileJobCustomerPaymentFlags(supabase, input.job_id);
  await syncInvoiceCollectionStagesForJob(supabase, input.job_id);

  return data as JobPayment;
}

export async function deleteJobPayment(id: string): Promise<void> {
  const supabase = getSupabase();
  const { data: row } = await supabase.from("job_payments").select("job_id").eq("id", id).maybeSingle();
  await softDeleteById("job_payments", id);
  const jobId = (row as { job_id?: string } | null)?.job_id;
  if (jobId) {
    await reconcileJobCustomerPaymentFlags(supabase, jobId);
    await syncInvoiceCollectionStagesForJob(supabase, jobId);
  }
}
