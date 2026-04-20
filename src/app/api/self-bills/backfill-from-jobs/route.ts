import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { getWeekBoundsForDate, partnerFieldSelfBillPaymentDueDate } from "@/lib/self-bill-period";

function uniqueRef(weekLabel: string, jobRef: string): string {
  const short = jobRef.replace(/\s/g, "").slice(0, 8);
  return `SB-${weekLabel}-${short}`;
}

type JobRow = {
  id: string;
  reference: string;
  partner_id: string;
  partner_name: string | null;
  partner_cost: number | null;
  materials_cost: number | null;
  created_at: string;
  self_bill_id: string | null;
};

async function recomputeSelfBillTotalsFromDb(supabase: ReturnType<typeof createServiceClient>, selfBillId: string) {
  const { data: rows, error } = await supabase
    .from("jobs")
    .select("partner_cost, materials_cost")
    .eq("self_bill_id", selfBillId)
    .is("deleted_at", null);
  if (error) throw error;
  const list = (rows ?? []) as { partner_cost?: number | null; materials_cost?: number | null }[];
  const jobsCount = list.length;
  let jobValue = 0;
  let materials = 0;
  for (const r of list) {
    jobValue += Number(r.partner_cost) || 0;
    materials += Number(r.materials_cost) || 0;
  }
  const commission = 0;
  await supabase
    .from("self_bills")
    .update({
      jobs_count: jobsCount,
      job_value: jobValue,
      materials,
      commission,
      net_payout: jobValue + materials - commission,
    })
    .eq("id", selfBillId);
}

/**
 * Build weekly self-bills from existing jobs that have a partner but no self_bill_id yet.
 * Groups by (partner_id, ISO week of created_at), inserts one row per group, links jobs, recomputes totals.
 */
export async function POST() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const supabase = createServiceClient();
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, reference, partner_id, partner_name, partner_cost, materials_cost, created_at, self_bill_id")
    .not("partner_id", "is", null)
    .is("deleted_at", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const toProcess = ((jobs ?? []) as JobRow[]).filter((j) => j.partner_id && !j.self_bill_id);
  const groups = new Map<string, JobRow[]>();

  for (const job of toProcess) {
    const { weekStart } = getWeekBoundsForDate(new Date(job.created_at));
    const key = `${job.partner_id}|${weekStart}`;
    const list = groups.get(key) ?? [];
    list.push(job);
    groups.set(key, list);
  }

  // Pre-fetch payment_terms for all involved partners
  const partnerIds = [...new Set(toProcess.map((j) => j.partner_id).filter(Boolean))];
  const partnerTermsMap = new Map<string, string | null>();
  if (partnerIds.length > 0) {
    const { data: partnerRows } = await supabase
      .from("partners")
      .select("id, payment_terms")
      .in("id", partnerIds);
    for (const p of partnerRows ?? []) {
      const pr = p as { id: string; payment_terms?: string | null };
      partnerTermsMap.set(pr.id, pr.payment_terms ?? null);
    }
  }

  let billsCreated = 0;
  let jobsLinked = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const [, groupJobs] of groups) {
    if (groupJobs.length === 0) continue;
    const first = groupJobs[0];
    const { weekStart, weekEnd, weekLabel } = getWeekBoundsForDate(new Date(first.created_at));

    const { data: existing } = await supabase
      .from("self_bills")
      .select("id")
      .eq("partner_id", first.partner_id)
      .eq("week_start", weekStart)
      .maybeSingle();

    let sbId = existing?.id as string | undefined;

    if (!sbId) {
      const ref = uniqueRef(weekLabel, first.reference);
      const status = weekEnd < today ? "pending_review" : "accumulating";
      const paymentTerms = partnerTermsMap.get(first.partner_id) ?? null;
      const dueDate = partnerFieldSelfBillPaymentDueDate(weekEnd, paymentTerms);
      const { data: ins, error: insErr } = await supabase
        .from("self_bills")
        .insert({
          reference: ref,
          partner_id: first.partner_id,
          partner_name: first.partner_name?.trim() || "Partner",
          period: weekStart.slice(0, 7),
          week_start: weekStart,
          week_end: weekEnd,
          week_label: weekLabel,
          jobs_count: 0,
          job_value: 0,
          materials: 0,
          commission: 0,
          net_payout: 0,
          status,
          payment_cadence: "weekly",
          due_date: dueDate,
        })
        .select("id")
        .single();

      if (insErr) {
        const { data: race } = await supabase
          .from("self_bills")
          .select("id")
          .eq("partner_id", first.partner_id)
          .eq("week_start", weekStart)
          .maybeSingle();
        sbId = race?.id as string | undefined;
        if (!sbId) continue;
      } else {
        sbId = ins.id as string;
        billsCreated += 1;
      }
    }

    const ids = groupJobs.map((j) => j.id);
    const { error: bulkErr } = await supabase
      .from("jobs")
      .update({ self_bill_id: sbId })
      .in("id", ids)
      .is("deleted_at", null);
    if (!bulkErr) jobsLinked += ids.length;
    await recomputeSelfBillTotalsFromDb(supabase, sbId);
  }

  return NextResponse.json({
    ok: true,
    partnerWeekGroups: groups.size,
    jobsConsidered: toProcess.length,
    jobsLinked,
    billsCreated,
  });
}
