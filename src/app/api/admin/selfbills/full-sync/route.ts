import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { partnerFieldSelfBillPaymentDueDate } from "@/lib/self-bill-period";
import { ensureWeeklySelfBillForJob } from "@/services/self-bills";

export const dynamic = "force-dynamic";

const ADMIN_ROLES = new Set(["admin", "manager"]);
const CHUNK = 200;

/** Job statuses that mean the job has been approved and finalised */
const APPROVED_JOB_STATUSES = new Set(["awaiting_payment", "completed"]);

/** Self-bill statuses we can promote to ready_to_pay */
const PROMOTABLE_STATUSES = new Set(["draft", "accumulating", "pending_review"]);

/** Self-bill statuses we must never touch */
const SKIP_STATUSES = new Set(["paid", "payout_cancelled", "payout_archived", "payout_lost"]);

/**
 * POST /api/admin/selfbills/full-sync
 *
 * 1. Backfill: every job with a partner but no self_bill_id gets linked to its weekly self-bill
 * 2. Status sync: self-bills whose linked jobs are all approved → promoted to ready_to_pay
 * 3. Totals: recompute jobs_count / job_value / materials / net_payout for every non-paid self-bill
 * 4. Due dates: recalculate from partner.payment_terms for every non-paid self-bill
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!ADMIN_ROLES.has(role)) {
    return NextResponse.json({ error: "Admin or manager required" }, { status: 403 });
  }

  const admin = createServiceClient();
  const stats = { backfilled: 0, promoted: 0, totalsUpdated: 0, dueDatesUpdated: 0, errors: 0 };

  // ── 1. Backfill: jobs with partner but no self_bill_id ────────────────────
  const { data: orphanJobs } = await admin
    .from("jobs")
    .select("id, reference, partner_id, partner_name, created_at, status, partner_cost, materials_cost, partner_agreed_value, property_address, deleted_at, partner_cancelled_at, self_bill_id, invoice_id, job_type, bill_origin")
    .not("partner_id", "is", null)
    .is("self_bill_id", null)
    .is("deleted_at", null)
    .neq("status", "cancelled");

  for (const job of orphanJobs ?? []) {
    try {
      const sbId = await ensureWeeklySelfBillForJob(job as unknown as Parameters<typeof ensureWeeklySelfBillForJob>[0]);
      if (sbId) {
        await admin.from("jobs").update({ self_bill_id: sbId }).eq("id", job.id);
        stats.backfilled++;
      }
    } catch (e) {
      console.error("[full-sync] backfill error", job.id, e);
      stats.errors++;
    }
  }

  // ── 2. Load all non-paid self-bills with their jobs ───────────────────────
  const { data: allSelfBills } = await admin
    .from("self_bills")
    .select("id, partner_id, week_end, due_date, status, bill_origin")
    .is("deleted_at", null)
    .not("status", "in", '("paid","payout_cancelled","payout_archived","payout_lost")');

  const selfBills = (allSelfBills ?? []) as {
    id: string;
    partner_id: string | null;
    week_end: string | null;
    due_date: string | null;
    status: string;
    bill_origin: string | null;
  }[];

  if (selfBills.length === 0) {
    return NextResponse.json({ ok: true, ...stats });
  }

  // ── 3. Load all linked jobs for these self-bills ──────────────────────────
  const selfBillIds = selfBills.map((s) => s.id);
  type SyncJobRow = { status: string; partner_cost: number; materials_cost: number; partner_cancelled_at?: string | null };
  const jobsBySb = new Map<string, SyncJobRow[]>();

  for (let i = 0; i < selfBillIds.length; i += CHUNK) {
    const { data: jobs } = await admin
      .from("jobs")
      .select("self_bill_id, status, partner_cost, materials_cost, deleted_at, partner_cancelled_at")
      .in("self_bill_id", selfBillIds.slice(i, i + CHUNK))
      .is("deleted_at", null);

    for (const j of jobs ?? []) {
      const sbId = (j as { self_bill_id: string }).self_bill_id;
      const list = jobsBySb.get(sbId) ?? [];
      list.push(j as SyncJobRow);
      jobsBySb.set(sbId, list);
    }
  }

  // ── 4. Load partner payment_terms ─────────────────────────────────────────
  const partnerIds = [...new Set(selfBills.map((s) => s.partner_id).filter(Boolean) as string[])];
  const partnerTermsMap = new Map<string, string | null>();
  for (let i = 0; i < partnerIds.length; i += CHUNK) {
    const { data: partners } = await admin
      .from("partners")
      .select("id, payment_terms")
      .in("id", partnerIds.slice(i, i + CHUNK));
    for (const p of partners ?? []) {
      const pr = p as { id: string; payment_terms?: string | null };
      partnerTermsMap.set(pr.id, pr.payment_terms ?? null);
    }
  }

  // ── 5. Update each self-bill ───────────────────────────────────────────────
  const BATCH = 50;
  const updates: { id: string; patch: Record<string, unknown> }[] = [];

  for (const sb of selfBills) {
    if (SKIP_STATUSES.has(sb.status) || sb.bill_origin === "internal") continue;

    const jobs = jobsBySb.get(sb.id) ?? [];
    const payable = jobs.filter((j) => j.status !== "cancelled");

    const jobValue = payable.reduce((s, j) => s + (Number(j.partner_cost) || 0), 0);
    const materials = payable.reduce((s, j) => s + (Number(j.materials_cost) || 0), 0);
    const netPayout = jobValue + materials;

    const patch: Record<string, unknown> = {
      jobs_count: payable.length,
      job_value: jobValue,
      materials,
      commission: 0,
      net_payout: netPayout,
    };

    // Void self-bills whose every linked job is now cancelled/lost
    if (payable.length === 0 && jobs.length > 0) {
      const hasPartnerCancel = jobs.some((j) => j.partner_cancelled_at);
      patch.status = hasPartnerCancel ? "payout_lost" : "payout_cancelled";
      patch.partner_status_label = hasPartnerCancel ? "Lost" : "Cancelled";
      patch.payout_void_reason = hasPartnerCancel ? "Jobs cancelled by partner" : "Jobs cancelled";
      stats.promoted++;
    }

    // Promote to ready_to_pay only if ALL payable jobs were explicitly approved
    if (
      PROMOTABLE_STATUSES.has(sb.status) &&
      payable.length > 0 &&
      payable.every((j) => APPROVED_JOB_STATUSES.has(j.status))
    ) {
      patch.status = "ready_to_pay";
      stats.promoted++;
    }

    // Recalculate due date
    if (sb.week_end) {
      const terms = sb.partner_id ? partnerTermsMap.get(sb.partner_id) ?? null : null;
      const newDueDate = partnerFieldSelfBillPaymentDueDate(sb.week_end, terms);
      const oldDueDate = sb.due_date ? String(sb.due_date).slice(0, 10) : null;
      if (newDueDate !== oldDueDate) {
        patch.due_date = newDueDate;
        stats.dueDatesUpdated++;
      }
    }

    updates.push({ id: sb.id, patch });
    stats.totalsUpdated++;
  }

  for (let i = 0; i < updates.length; i += BATCH) {
    await Promise.all(
      updates.slice(i, i + BATCH).map(({ id, patch }) =>
        admin.from("self_bills").update(patch).eq("id", id),
      ),
    );
  }

  return NextResponse.json({ ok: true, ...stats });
}
