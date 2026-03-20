import { getSupabase, softDeleteById } from "./base";
import type { JobPayment, JobPaymentType } from "@/types/database";

export interface CreateJobPaymentInput {
  job_id: string;
  type: JobPaymentType;
  amount: number;
  payment_date: string;
  note?: string;
  created_by?: string;
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
      created_by: input.created_by ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as JobPayment;
}

export async function deleteJobPayment(id: string): Promise<void> {
  await softDeleteById("job_payments", id);
}
