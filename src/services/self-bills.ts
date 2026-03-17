import { getSupabase } from "./base";
import type { Job, SelfBill } from "@/types/database";

export type CreateSelfBillFromJobInput = Pick<
  Job,
  "id" | "reference" | "partner_name" | "partner_cost" | "materials_cost"
>;

/**
 * Create a self-bill from a job when it moves to Awaiting Payment (report approved).
 * Links job to the new self_bill via job.self_bill_id.
 */
export async function createSelfBillFromJob(job: CreateSelfBillFromJobInput): Promise<SelfBill> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const period = now.slice(0, 7); // YYYY-MM
  const reference = `SB-${job.reference}`;
  const jobValue = Number(job.partner_cost) || 0;
  const materials = Number(job.materials_cost) || 0;
  const commission = 0;
  const netPayout = jobValue + materials - commission;

  const row = {
    reference,
    partner_name: job.partner_name?.trim() || "Unassigned",
    period,
    jobs_count: 1,
    job_value: jobValue,
    materials,
    commission,
    net_payout: netPayout,
    status: "awaiting_payment" as const,
  };

  const { data, error } = await supabase
    .from("self_bills")
    .insert(row)
    .select()
    .single();

  if (error) throw error;
  return data as SelfBill;
}
