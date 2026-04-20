import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./base";
import type { Job, SelfBill, SelfBillStatus } from "@/types/database";
import { getWeekBoundsForDate } from "@/lib/self-bill-period";
import { isSupabaseMissingColumnError, parsePostgrestUnknownColumnName } from "@/lib/supabase-schema-compat";

const JOB_LINE_FOR_SB_FULL =
  "id, reference, title, partner_cost, partner_agreed_value, materials_cost, status, property_address, deleted_at, partner_cancelled_at";
const JOB_LINE_FOR_SB_FULL_WITH_LINK =
  "id, reference, title, partner_cost, partner_agreed_value, materials_cost, status, property_address, self_bill_id, deleted_at, partner_cancelled_at";
const JOB_LINE_FOR_SB_LEGACY =
  "id, reference, title, partner_cost, partner_agreed_value, materials_cost, status, property_address, deleted_at";
const JOB_LINE_FOR_SB_LEGACY_WITH_LINK =
  "id, reference, title, partner_cost, partner_agreed_value, materials_cost, status, property_address, self_bill_id, deleted_at";

export type SelfBillJobLine = Pick<
  Job,
  "id" | "reference" | "title" | "partner_cost" | "partner_agreed_value" | "materials_cost" | "status" | "property_address"
> & {
  deleted_at?: string | null;
  partner_cancelled_at?: string | null;
};

export type SelfBillLinkedJobRow = SelfBillJobLine & { self_bill_id: string };

async function fetchJobLinesForSelfBill(
  supabase: SupabaseClient,
  options: { selfBillId: string } | { selfBillIds: string[] },
  includeSelfBillIdColumn: boolean,
): Promise<SelfBillJobLine[] | SelfBillLinkedJobRow[]> {
  const full = includeSelfBillIdColumn ? JOB_LINE_FOR_SB_FULL_WITH_LINK : JOB_LINE_FOR_SB_FULL;
  const legacy = includeSelfBillIdColumn ? JOB_LINE_FOR_SB_LEGACY_WITH_LINK : JOB_LINE_FOR_SB_LEGACY;

  const build = (cols: string) => {
    let q = supabase.from("jobs").select(cols).order("reference", { ascending: true });
    if ("selfBillId" in options) {
      q = q.eq("self_bill_id", options.selfBillId);
    } else {
      if (options.selfBillIds.length === 0) return null;
      q = q.in("self_bill_id", options.selfBillIds);
    }
    return q;
  };

  const first = build(full);
  if (!first) return [];

  let { data, error } = await first;
  /** Any missing column in the “full” select — retry without `partner_cancelled_at` (older DBs). */
  if (error && isSupabaseMissingColumnError(error)) {
    const second = build(legacy);
    if (second) ({ data, error } = await second);
  }
  if (error) throw error;
  return (data ?? []) as unknown as SelfBillJobLine[] | SelfBillLinkedJobRow[];
}

export type CreateSelfBillFromJobInput = Pick<
  Job,
  "id" | "reference" | "partner_name" | "partner_cost" | "materials_cost"
>;

/** Self-bills with zero payout due to archived / cancelled / lost jobs (kept visible for audit). */
export const SELF_BILL_PAYOUT_VOID_STATUSES: SelfBillStatus[] = [
  "payout_archived",
  "payout_cancelled",
  "payout_lost",
];

/**
 * Terminal statuses: a new job must never be linked to a self-bill in one of these states.
 * Instead, a fresh self-bill is created so the new job has no history with the old one.
 */
export const SELF_BILL_TERMINAL_STATUSES: SelfBillStatus[] = [
  ...SELF_BILL_PAYOUT_VOID_STATUSES,
  "rejected",
];

export function isSelfBillPayoutVoided(sb: Pick<SelfBill, "status">): boolean {
  return SELF_BILL_PAYOUT_VOID_STATUSES.includes(sb.status);
}

function uniqueRef(weekLabel: string, jobRef: string): string {
  const short = jobRef.replace(/\s/g, "").slice(0, 8);
  return `SB-${weekLabel}-${short}`;
}

type JobPayoutRow = {
  partner_cost?: number | null;
  materials_cost?: number | null;
  status?: string | null;
  deleted_at?: string | null;
  partner_cancelled_at?: string | null;
};

/** Active jobs that still count toward partner payout on a weekly self-bill. */
export function jobContributesToSelfBillPayout(j: Pick<Job, "status" | "deleted_at">): boolean {
  if (j.deleted_at) return false;
  if (j.status === "deleted") return false;
  if (j.status === "cancelled") return false;
  return true;
}

/** Partner-readable job state when the job no longer counts toward payout (for UI / PDF). */
export function selfBillJobPayoutStateLabel(
  j: Pick<Job, "status" | "deleted_at" | "partner_cancelled_at">,
): string | null {
  if (j.deleted_at) return j.status === "deleted" ? "Deleted" : "Archived";
  if (j.status === "cancelled" && j.partner_cancelled_at) return "Lost";
  if (j.status === "cancelled") return "Cancelled";
  return null;
}

/**
 * Recompute labour/materials/net from linked jobs that are still payable (not archived, not cancelled).
 * Does not assign payout-void status — use `refreshSelfBillPayoutState` after job lifecycle changes.
 */
export async function recomputeSelfBillTotals(selfBillId: string): Promise<void> {
  const supabase = getSupabase();
  const { data: rows, error: selErr } = await supabase
    .from("jobs")
    .select("partner_cost, materials_cost, status, deleted_at")
    .eq("self_bill_id", selfBillId);
  if (selErr) throw selErr;
  const list = (rows ?? []) as JobPayoutRow[];
  const payable = list.filter((r) => !r.deleted_at && r.status !== "cancelled" && r.status !== "deleted");
  const jobsCount = payable.length;
  let jobValue = 0;
  let materials = 0;
  for (const r of payable) {
    jobValue += Number(r.partner_cost) || 0;
    materials += Number(r.materials_cost) || 0;
  }
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
 * Recompute totals from payable jobs, then set payout-void status (or reopen accumulating) from linked job states.
 * Skips **paid** and **internal** self-bills. Call after job status/archive changes and weekly linking.
 */
export async function refreshSelfBillPayoutState(selfBillId: string): Promise<void> {
  const supabase = getSupabase();
  const before = await getSelfBill(selfBillId);
  if (!before) return;
  if (before.bill_origin === "internal") return;
  if (before.status === "paid") return;

  const prevNet = Number(before.net_payout) || 0;
  const prevOriginalSnapshot = before.original_net_payout;

  /** One jobs query for both totals recompute and payout-void logic (saves 2 round-trips vs recompute + refetch + second select). */
  const jobColsFull = "partner_cost, materials_cost, status, deleted_at, partner_cancelled_at";
  const jobColsLegacy = "partner_cost, materials_cost, status, deleted_at";
  const jobQuery1 = await supabase.from("jobs").select(jobColsFull).eq("self_bill_id", selfBillId);
  let jErr = jobQuery1.error;
  let jobs: JobPayoutRow[];
  if (jErr && isSupabaseMissingColumnError(jErr)) {
    const retry = await supabase.from("jobs").select(jobColsLegacy).eq("self_bill_id", selfBillId);
    jErr = retry.error;
    jobs = (retry.data ?? []) as JobPayoutRow[];
  } else {
    if (jErr) throw jErr;
    jobs = (jobQuery1.data ?? []) as JobPayoutRow[];
  }

  const payable = jobs.filter((r) => !r.deleted_at && r.status !== "cancelled" && r.status !== "deleted");
  const jobsCount = payable.length;
  let jobValue = 0;
  let materials = 0;
  for (const r of payable) {
    jobValue += Number(r.partner_cost) || 0;
    materials += Number(r.materials_cost) || 0;
  }
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

  const paying = payable;

  if (paying.length > 0) {
    if (SELF_BILL_PAYOUT_VOID_STATUSES.includes(before.status)) {
      const net = netPayout;
      if (net > 0.02) {
        const { error: up } = await supabase
          .from("self_bills")
          .update({
            status: "accumulating",
            payout_void_reason: null,
            partner_status_label: null,
          })
          .eq("id", selfBillId);
        if (up) throw up;
      }
    }
    return;
  }

  if (jobs.length === 0) return;

  const hasArchived = jobs.some((j) => Boolean(j.deleted_at));
  const hasLost = jobs.some((j) => j.status === "cancelled" && j.partner_cancelled_at);
  const hasOfficeCancel = jobs.some((j) => j.status === "cancelled" && !j.partner_cancelled_at);

  let nextStatus: SelfBillStatus;
  let partnerLabel: string;
  let reason: string;

  if (hasArchived) {
    nextStatus = "payout_archived";
    partnerLabel = "Archived";
    reason = jobs.length > 1 ? "Jobs archived and removed from payout" : "Job archived and removed from payout";
  } else if (hasLost) {
    nextStatus = "payout_lost";
    partnerLabel = "Lost";
    reason = jobs.length > 1 ? "Jobs marked as lost" : "Job marked as lost";
  } else if (hasOfficeCancel) {
    nextStatus = "payout_cancelled";
    partnerLabel = "Cancelled";
    reason = jobs.length > 1 ? "Jobs cancelled before completion" : "Job cancelled before completion";
  } else {
    nextStatus = "payout_cancelled";
    partnerLabel = "Cancelled";
    reason = "No payable amount on this self-bill";
  }

  const originalNetPayout =
    prevOriginalSnapshot != null && Number.isFinite(Number(prevOriginalSnapshot))
      ? Number(prevOriginalSnapshot)
      : prevNet > 0.02
        ? prevNet
        : null;

  /**
   * Progressively drop columns that the DB's schema cache doesn't know about (migration 100
   * adds `payout_void_reason` / `partner_status_label` / `original_net_payout`; older DBs
   * return PGRST204 for those). Without this retry, the whole status transition was getting
   * swallowed by the caller's try/catch, leaving bills stuck in their pre-cancel status
   * with zeroed totals.
   */
  const voidPatch: Record<string, unknown> = {
    status: nextStatus,
    jobs_count: 0,
    job_value: 0,
    materials: 0,
    commission: 0,
    net_payout: 0,
    payout_void_reason: reason,
    partner_status_label: partnerLabel,
    ...(originalNetPayout != null ? { original_net_payout: originalNetPayout } : {}),
  };
  let voidErr: unknown = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const { error } = await supabase.from("self_bills").update(voidPatch).eq("id", selfBillId);
    if (!error) {
      voidErr = null;
      break;
    }
    voidErr = error;
    const col = parsePostgrestUnknownColumnName(error);
    if (col && col in voidPatch && col !== "status") {
      delete voidPatch[col];
      continue;
    }
    if (isSupabaseMissingColumnError(error)) {
      // Drop the optional partner-facing columns and retry with the minimum set.
      delete voidPatch.payout_void_reason;
      delete voidPatch.partner_status_label;
      delete voidPatch.original_net_payout;
      continue;
    }
    break;
  }
  if (voidErr) throw voidErr;
}

export type EnsureWeeklySelfBillOptions = {
  weekAnchorDate?: Date;
};

export async function ensureWeeklySelfBillForJob(job: Job, options?: EnsureWeeklySelfBillOptions): Promise<string | null> {
  if (!job.partner_id?.trim()) return null;
  const supabase = getSupabase();
  let partnerId = job.partner_id.trim();
  /** `self_bills.partner_id` FK → `partners.id`; jobs can still hold a stale/invalid UUID. */
  const { data: partnerRowInit, error: partnerLookupErr } = await supabase
    .from("partners")
    .select("id")
    .eq("id", partnerId)
    .maybeSingle();
  if (partnerLookupErr) throw partnerLookupErr;
  let partnerRow = partnerRowInit;
  if (!partnerRow?.id) {
    const partnerName = (job.partner_name ?? "").trim();
    if (partnerName) {
      const byCompany = await supabase
        .from("partners")
        .select("id")
        .ilike("company_name", partnerName)
        .limit(1)
        .maybeSingle();
      if (byCompany.error) throw byCompany.error;
      if (byCompany.data?.id) {
        partnerRow = byCompany.data;
      } else {
        const byContact = await supabase
          .from("partners")
          .select("id")
          .ilike("contact_name", partnerName)
          .limit(1)
          .maybeSingle();
        if (byContact.error) throw byContact.error;
        if (byContact.data?.id) partnerRow = byContact.data;
      }
    }
    if (!partnerRow?.id) {
      throw new Error(
        "This partner is not in the directory (link broken or partner removed). Re-assign the partner on the job, then create the self-bill again.",
      );
    }
    partnerId = String(partnerRow.id).trim();
    const { error: repairErr } = await supabase.from("jobs").update({ partner_id: partnerId }).eq("id", job.id);
    if (repairErr) throw repairErr;
  }
  const anchor = options?.weekAnchorDate ?? new Date(job.created_at);
  const { weekStart, weekEnd, weekLabel } = getWeekBoundsForDate(anchor);

  const { data: existing, error: selErr } = await supabase
    .from("self_bills")
    .select("id, status")
    .eq("partner_id", partnerId)
    .eq("week_start", weekStart)
    .limit(1)
    .maybeSingle();

  if (selErr) throw selErr;

  const existingRow = existing as { id: string; status: string } | null;
  // Terminal self-bills (voided / rejected) belong to their own history.
  // New jobs always get a fresh self-bill so they have no link to cancelled/rejected ones.
  const isTerminal = existingRow
    ? SELF_BILL_TERMINAL_STATUSES.includes(existingRow.status as SelfBillStatus)
    : false;
  let sbId = existingRow && !isTerminal ? (existingRow.id as string) : undefined;

  if (!sbId) {
    const ref = uniqueRef(weekLabel, job.reference);
    const row = {
      reference: ref,
      partner_id: partnerId,
      partner_name: job.partner_name?.trim() || "Partner",
      bill_origin: "partner" as const,
      period: weekStart.slice(0, 7),
      week_start: weekStart,
      week_end: weekEnd,
      week_label: weekLabel,
      jobs_count: 0,
      job_value: 0,
      materials: 0,
      commission: 0,
      net_payout: 0,
      status: "draft" as const,
      payment_cadence: "weekly",
    };
    let { data: ins, error: insErr } = await supabase.from("self_bills").insert(row).select("id").single();
    if (insErr && isSupabaseMissingColumnError(insErr, "bill_origin")) {
      const { bill_origin: _bo, ...rowLegacy } = row;
      ({ data: ins, error: insErr } = await supabase.from("self_bills").insert(rowLegacy).select("id").single());
    }
    if (insErr) {
      const code = (insErr as { code?: string }).code;
      const msg = insErr.message ?? "";
      const isFkPartner =
        code === "23503" || msg.includes("self_bills_partner_id_fkey") || msg.includes("foreign key constraint");
      if (isFkPartner) {
        throw new Error(
          "Partner is not in the directory (self_bills require a valid partners row). Re-assign the partner on the job, then try again.",
        );
      }
      const isStatusCheck =
        code === "23514" || msg.includes("self_bills_status_check") || msg.includes("violates check constraint");
      if (isStatusCheck) {
        const { data: ins2, error: insErr2 } = await supabase
          .from("self_bills")
          .insert({ ...row, status: "accumulating" as const })
          .select("id")
          .single();
        if (!insErr2 && ins2) {
          sbId = ins2.id as string;
        } else if (insErr2) {
          const { data: race } = await supabase
            .from("self_bills")
            .select("id, status")
            .eq("partner_id", partnerId)
            .eq("week_start", weekStart)
            .not("status", "in", `(${SELF_BILL_TERMINAL_STATUSES.join(",")})`)
            .limit(1)
            .maybeSingle();
          sbId = (race as { id: string } | null)?.id;
          if (!sbId) throw insErr2;
        }
      } else {
        const { data: race } = await supabase
          .from("self_bills")
          .select("id, status")
          .eq("partner_id", partnerId)
          .eq("week_start", weekStart)
          .not("status", "in", `(${SELF_BILL_TERMINAL_STATUSES.join(",")})`)
          .limit(1)
          .maybeSingle();
        sbId = (race as { id: string } | null)?.id;
        if (!sbId) throw insErr;
      }
    } else {
      if (!ins?.id) throw new Error("Self-bill insert returned no id");
      sbId = ins.id as string;
    }
  }

  if (!sbId) throw new Error("Failed to create or find weekly self-bill");

  const { error: linkErr } = await supabase.from("jobs").update({ self_bill_id: sbId }).eq("id", job.id);
  if (linkErr) throw linkErr;

  try {
    await refreshSelfBillPayoutState(sbId);
  } catch (e) {
    console.error("refreshSelfBillPayoutState after weekly self-bill link:", e);
  }
  return sbId;
}

export async function syncSelfBillAfterJobChange(job: Job): Promise<void> {
  if (!job.self_bill_id) return;
  try {
    await refreshSelfBillPayoutState(job.self_bill_id);
  } catch (e) {
    console.error("syncSelfBillAfterJobChange failed:", e);
  }
}

/** After bulk job updates that bypass `updateJob`, refresh every linked weekly self-bill. */
export async function refreshSelfBillPayoutStatesForJobIds(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  const supabase = getSupabase();
  const { data, error } = await supabase.from("jobs").select("self_bill_id").in("id", jobIds);
  if (error) {
    console.error("refreshSelfBillPayoutStatesForJobIds:", error);
    return;
  }
  const sbIds = [
    ...new Set(
      (data ?? [])
        .map((r) => (r as { self_bill_id?: string | null }).self_bill_id)
        .filter((x): x is string => Boolean(x && String(x).trim())),
    ),
  ];
  await Promise.all(sbIds.map((bid) => refreshSelfBillPayoutState(bid).catch((e) => console.error("refreshSelfBillPayoutState", bid, e))));
}

export async function listSelfBillsLinkedToJob(
  jobReference: string,
  primarySelfBillId?: string | null,
): Promise<SelfBill[]> {
  const supabase = getSupabase();
  const { data: jobRow, error: jobErr } = await supabase
    .from("jobs")
    .select("self_bill_id")
    .eq("reference", jobReference)
    .is("deleted_at", null)
    .maybeSingle();
  if (jobErr) throw jobErr;
  const ids = new Set<string>();
  if (jobRow?.self_bill_id) ids.add(jobRow.self_bill_id as string);
  if (primarySelfBillId) ids.add(primarySelfBillId);
  if (ids.size === 0) return [];
  const { data, error } = await supabase.from("self_bills").select("*").in("id", [...ids]);
  if (error) throw error;
  const rows = (data ?? []) as SelfBill[];
  if (primarySelfBillId && !rows.some((r) => r.id === primarySelfBillId)) {
    const { data: primary } = await supabase.from("self_bills").select("*").eq("id", primarySelfBillId).maybeSingle();
    const p = primary as SelfBill | null;
    if (p) rows.unshift(p);
  }
  return rows;
}

/**
 * When a job is cancelled, mark linked self-bills as payout-cancelled (void-like state).
 * Skips paid / already voided rows and never sends anything.
 */
export async function cancelOpenSelfBillsForJobCancellation(options: {
  jobReference: string;
  primarySelfBillId?: string | null;
}): Promise<void> {
  const linked = await listSelfBillsLinkedToJob(options.jobReference, options.primarySelfBillId);
  const eligible = linked.filter((sb) => {
    if (sb.status === "paid") return false;
    if (SELF_BILL_TERMINAL_STATUSES.includes(sb.status)) return false;
    return true;
  });
  if (eligible.length === 0) return;

  const supabase = getSupabase();

  // For weekly self-bills with multiple jobs, only void when no active jobs remain.
  await Promise.all(eligible.map(async (sb) => {
    const { data: activeJobs } = await supabase
      .from("jobs")
      .select("id")
      .eq("self_bill_id", sb.id)
      .not("status", "in", "(cancelled,deleted)")
      .is("deleted_at", null)
      .limit(1);
    if (activeJobs?.length) return; // other active jobs remain — leave self-bill intact
    const patch: Record<string, unknown> = {
      status: "payout_cancelled" as const,
      partner_status_label: "Cancelled",
    };
    const { error } = await supabase.from("self_bills").update(patch).eq("id", sb.id);
    if (!error) return;
    // Older DB schemas may not have partner_status_label — retry with status only.
    if (isSupabaseMissingColumnError(error)) {
      const { error: retryErr } = await supabase
        .from("self_bills")
        .update({ status: "payout_cancelled" as const })
        .eq("id", sb.id);
      if (retryErr) throw retryErr;
      return;
    }
    throw error;
  }));
}

export type CreateSelfBillFromJobOptions = {
  /** When set (e.g. Review & approve), weekly bucket follows this instant instead of scheduled/created date. */
  weekAnchorDate?: Date;
};

export async function createSelfBillFromJob(
  job: CreateSelfBillFromJobInput,
  options?: CreateSelfBillFromJobOptions,
): Promise<SelfBill> {
  const supabase = getSupabase();
  const { data: full, error: fullErr } = await supabase.from("jobs").select("*").eq("id", job.id).single();
  if (fullErr) throw fullErr;
  if (!full) throw new Error("Job not found");
  const j = full as Job;
  let weekAnchorDate: Date;
  if (options?.weekAnchorDate) {
    weekAnchorDate = options.weekAnchorDate;
  } else {
    /** Week for the self-bill bucket: scheduled day if set, else job creation (not “today”, which mis-buckets approvals). */
    const sched = typeof j.scheduled_date === "string" ? j.scheduled_date.trim().slice(0, 10) : "";
    const anchorDay =
      sched && /^\d{4}-\d{2}-\d{2}$/.test(sched)
        ? sched
        : (j.created_at ? String(j.created_at).slice(0, 10) : "");
    weekAnchorDate = anchorDay ? new Date(`${anchorDay}T12:00:00`) : new Date();
  }
  const id = await ensureWeeklySelfBillForJob(j, { weekAnchorDate });
  if (!id) throw new Error("Partner required for self-bill");
  const row = await getSelfBill(id);
  if (!row) throw new Error("Self-bill not found after create");
  return row;
}

export async function getSelfBill(id: string): Promise<SelfBill | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("self_bills").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as SelfBill) ?? null;
}

export async function updateSelfBillStatus(id: string, status: SelfBillStatus): Promise<SelfBill> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("self_bills")
    .update({ status })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as SelfBill;
}

export async function listJobsForSelfBill(selfBillId: string): Promise<SelfBillJobLine[]> {
  const supabase = getSupabase();
  const rows = await fetchJobLinesForSelfBill(supabase, { selfBillId }, false);
  return rows as SelfBillJobLine[];
}

const SELF_BILL_JOB_QUERY_CHUNK = 60;

/** Jobs linked to any of the given self-bills (chunked `.in()` + legacy column fallback). */
export async function listJobsLinkedToSelfBillIds(selfBillIds: string[]): Promise<SelfBillLinkedJobRow[]> {
  if (selfBillIds.length === 0) return [];
  const supabase = getSupabase();
  const out: SelfBillLinkedJobRow[] = [];
  for (let i = 0; i < selfBillIds.length; i += SELF_BILL_JOB_QUERY_CHUNK) {
    const chunk = selfBillIds.slice(i, i + SELF_BILL_JOB_QUERY_CHUNK);
    const rows = (await fetchJobLinesForSelfBill(supabase, { selfBillIds: chunk }, true)) as SelfBillLinkedJobRow[];
    out.push(...rows);
  }
  return out;
}
