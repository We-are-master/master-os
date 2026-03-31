import { getSupabase } from "./base";
import type { Job, SelfBill } from "@/types/database";
import { getWeekBoundsForDate } from "@/lib/self-bill-period";

export type CreateSelfBillFromJobInput = Pick<
  Job,
  "id" | "reference" | "partner_name" | "partner_cost" | "materials_cost"
>;

function uniqueRef(weekLabel: string, jobRef: string): string {
  const short = jobRef.replace(/\s/g, "").slice(0, 8);
  return `SB-${weekLabel}-${short}`;
}

/** Recompute aggregates from all jobs linked to this self-bill. */
export async function recomputeSelfBillTotals(selfBillId: string): Promise<void> {
  const supabase = getSupabase();
  const agg = await supabase
    .from("jobs")
    .select("id.count(), partner_cost.sum(), materials_cost.sum()")
    .eq("self_bill_id", selfBillId)
    .is("deleted_at", null)
    .maybeSingle();
  if (agg.error) throw agg.error;
  const row = (agg.data ?? {}) as Record<string, unknown>;
  const jobsCount = Number(row.id_count ?? 0) || 0;
  const jobValue = Number(row.partner_cost_sum ?? 0) || 0;
  const materials = Number(row.materials_cost_sum ?? 0) || 0;
  const commission = 0;
  const netPayout = jobValue + materials - commission;
  const { error: uErr } = await supabase
    .from("self_bills")
    .update({
      jobs_count: jobsCount,
      job_value: jobValue,
      materials,
      commission,
      net_payout: netPayout,
    })
    .eq("id", selfBillId);
  if (uErr) throw uErr;
}

/**
 * One weekly self-bill per partner (Mon–Sun), many jobs.
 * Uses job.created_at to determine the ISO week bucket.
 */
export async function ensureWeeklySelfBillForJob(job: Job): Promise<string | null> {
  if (!job.partner_id?.trim()) return null;
  const supabase = getSupabase();
  const created = new Date(job.created_at);
  const { weekStart, weekEnd, weekLabel } = getWeekBoundsForDate(created);

  const { data: existing, error: selErr } = await supabase
    .from("self_bills")
    .select("id")
    .eq("partner_id", job.partner_id)
    .eq("week_start", weekStart)
    .eq("status", "accumulating")
    .maybeSingle();

  if (selErr) throw selErr;

  let sbId = existing?.id as string | undefined;

  if (!sbId) {
    const ref = uniqueRef(weekLabel, job.reference);
    const row = {
      reference: ref,
      partner_id: job.partner_id,
      partner_name: job.partner_name?.trim() || "Partner",
      period: weekStart.slice(0, 7),
      week_start: weekStart,
      week_end: weekEnd,
      week_label: weekLabel,
      jobs_count: 0,
      job_value: 0,
      materials: 0,
      commission: 0,
      net_payout: 0,
      status: "accumulating" as const,
      payment_cadence: "weekly",
    };
    const { data: ins, error: insErr } = await supabase.from("self_bills").insert(row).select("id").single();
    if (insErr) {
      const { data: race } = await supabase
        .from("self_bills")
        .select("id")
        .eq("partner_id", job.partner_id)
        .eq("week_start", weekStart)
        .eq("status", "accumulating")
        .maybeSingle();
      sbId = race?.id as string | undefined;
      if (!sbId) throw insErr;
    } else {
      sbId = ins.id as string;
    }
  }

  const { error: linkErr } = await supabase.from("jobs").update({ self_bill_id: sbId }).eq("id", job.id);
  if (linkErr) throw linkErr;

  await recomputeSelfBillTotals(sbId);
  return sbId;
}

/** Call after job create/update when partner and money fields may have changed. */
export async function syncSelfBillAfterJobChange(job: Job): Promise<void> {
  if (!job.partner_id?.trim()) return;
  try {
    if (job.self_bill_id) {
      await recomputeSelfBillTotals(job.self_bill_id);
      return;
    }
    await ensureWeeklySelfBillForJob(job);
  } catch {
    /* non-fatal — finance can fix from Self-billing */
  }
}

/**
 * Legacy hook: when a job hits Awaiting Payment without a bill, attach to the weekly bucket.
 * Prefer syncSelfBillAfterJobChange from job create.
 */
export async function createSelfBillFromJob(job: CreateSelfBillFromJobInput): Promise<SelfBill> {
  const supabase = getSupabase();
  const { data: full } = await supabase.from("jobs").select("*").eq("id", job.id).single();
  if (!full) throw new Error("Job not found");
  const id = await ensureWeeklySelfBillForJob(full as Job);
  if (!id) throw new Error("Partner required for self-bill");
  const { data, error } = await supabase.from("self_bills").select("*").eq("id", id).single();
  if (error) throw error;
  return data as SelfBill;
}

export async function listJobsForSelfBill(selfBillId: string): Promise<Pick<Job, "id" | "reference" | "title" | "partner_cost" | "materials_cost" | "status" | "property_address">[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, reference, title, partner_cost, materials_cost, status, property_address")
    .eq("self_bill_id", selfBillId)
    .order("reference", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Pick<Job, "id" | "reference" | "title" | "partner_cost" | "materials_cost" | "status" | "property_address">[];
}
