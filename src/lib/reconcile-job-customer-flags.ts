import type { SupabaseClient } from "@supabase/supabase-js";
import { isJobPaymentsDeletedAtMissing } from "@/lib/supabase-schema-compat";

const EPS = 0.02;

/**
 * Recompute job.customer_deposit_paid / customer_final_paid from job_payments sums vs scheduled amounts.
 */
export async function reconcileJobCustomerPaymentFlags(client: SupabaseClient, jobId: string): Promise<void> {
  const { data: job, error: jobErr } = await client.from("jobs").select("*").eq("id", jobId).maybeSingle();
  if (jobErr || !job) return;

  // Soft-delete aware; fall back to no filter if `deleted_at` isn't on this DB (42703).
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
  const depSum = list.filter((p) => p.type === "customer_deposit").reduce((s, p) => s + Number(p.amount), 0);
  const finSum = list.filter((p) => p.type === "customer_final").reduce((s, p) => s + Number(p.amount), 0);

  const depNeed = Number(job.customer_deposit ?? 0);
  const finNeed = Number(job.customer_final_payment ?? 0);
  const totalCustomer = depSum + finSum;
  const totalNeed = depNeed + finNeed;

  let depositPaid = depNeed <= EPS || depSum >= depNeed - EPS;
  let finalPaid = finNeed <= EPS || finSum >= finNeed - EPS;
  /** One payment row (e.g. combined invoice / Stripe) covering deposit + final in full. */
  if (depNeed > EPS && finNeed > EPS && totalCustomer >= totalNeed - EPS) {
    depositPaid = true;
    finalPaid = true;
  }

  const patch: { customer_deposit_paid?: boolean; customer_final_paid?: boolean } = {};
  if (Boolean(job.customer_deposit_paid) !== depositPaid) patch.customer_deposit_paid = depositPaid;
  if (Boolean(job.customer_final_paid) !== finalPaid) patch.customer_final_paid = finalPaid;

  if (Object.keys(patch).length > 0) {
    await client.from("jobs").update(patch).eq("id", jobId);
  }
}
