import { getSupabase } from "./base";
import {
  partnerRatingBreakdown,
  type PartnerFeedbackEvent,
  type PartnerFeedbackKind,
  type PartnerFeedbackSource,
} from "@/lib/partner-rating";
import { updatePartner } from "./partners";
import type { JobStatus } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PartnerFeedbackRow = {
  id: string;
  kind: PartnerFeedbackKind;
  source: PartnerFeedbackSource;
  notes: string | null;
  job_reference: string | null;
  job_id: string | null;
  created_at: string;
  job_status: JobStatus | null;
};

export type PartnerRatingMeta = {
  rating: number;
  complaintCount: number;
  pointsLost: number;
  praiseCount: number;
  pointsGained: number;
  feedback: PartnerFeedbackRow[];
};

type FeedbackQueryRow = {
  id: string;
  kind: PartnerFeedbackKind;
  source: PartnerFeedbackSource;
  notes: string | null;
  job_reference: string | null;
  job_id: string | null;
  created_at: string;
  jobs: { status: JobStatus } | { status: JobStatus }[] | null;
};

function resolveJobStatus(jobs: FeedbackQueryRow["jobs"]): JobStatus | null {
  if (!jobs) return null;
  if (Array.isArray(jobs)) return jobs[0]?.status ?? null;
  return jobs.status ?? null;
}

export async function listPartnerFeedbackEvents(
  partnerId: string,
  supabase?: SupabaseClient,
): Promise<{ events: PartnerFeedbackEvent[]; rows: PartnerFeedbackRow[] }> {
  const client = supabase ?? getSupabase();
  const { data, error } = await client
    .from("partner_feedback")
    .select(
      "id, kind, source, notes, job_reference, job_id, created_at, jobs ( status )",
    )
    .eq("partner_id", partnerId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;

  const rows: PartnerFeedbackRow[] = (data ?? []).map((raw) => {
    const r = raw as FeedbackQueryRow;
    const jobStatus = resolveJobStatus(r.jobs);
    return {
      id: r.id,
      kind: r.kind,
      source: r.source,
      notes: r.notes,
      job_reference: r.job_reference,
      job_id: r.job_id,
      created_at: r.created_at,
      job_status: jobStatus,
    };
  });

  const events: PartnerFeedbackEvent[] = rows.map((row) => ({
    kind: row.kind,
    source: row.source,
    jobStatus: row.kind === "complaint" ? row.job_status : null,
  }));

  return { events, rows };
}

async function persistPartnerRating(
  partnerId: string,
  rating: number,
  supabase?: SupabaseClient,
): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from("partners").update({ rating }).eq("id", partnerId);
    if (error) throw error;
    return;
  }
  await updatePartner(partnerId, { rating });
}

export async function refreshPartnerRating(
  partnerId: string,
  supabase?: SupabaseClient,
): Promise<PartnerRatingMeta> {
  const { events, rows } = await listPartnerFeedbackEvents(partnerId, supabase);
  const breakdown = partnerRatingBreakdown(events);
  await persistPartnerRating(partnerId, breakdown.rating, supabase);
  return {
    rating: breakdown.rating,
    complaintCount: breakdown.complaintCount,
    pointsLost: breakdown.pointsLost,
    praiseCount: breakdown.praiseCount,
    pointsGained: breakdown.pointsGained,
    feedback: rows,
  };
}

export async function addManualPartnerFeedback(
  partnerId: string,
  input: {
    kind: PartnerFeedbackKind;
    notes?: string;
    jobId?: string;
    createdByUserId?: string;
  },
  supabase?: SupabaseClient,
): Promise<PartnerRatingMeta> {
  const client = supabase ?? getSupabase();
  const kind = input.kind === "complaint" ? "complaint" : "praise";
  const notes = input.notes?.trim().slice(0, 2000) || null;
  const jobId = input.jobId?.trim() || null;

  let jobReference: string | null = null;
  if (jobId) {
    const { data: job, error: jobErr } = await client
      .from("jobs")
      .select("id, reference, partner_id")
      .eq("id", jobId)
      .maybeSingle();
    if (jobErr || !job) throw new Error("Job not found");
    if ((job as { partner_id?: string }).partner_id !== partnerId) {
      throw new Error("Job does not belong to this partner");
    }
    jobReference = (job as { reference?: string }).reference ?? null;

    const { data: dup } = await client
      .from("partner_feedback")
      .select("id")
      .eq("partner_id", partnerId)
      .eq("job_id", jobId)
      .eq("kind", kind)
      .eq("source", "manual")
      .maybeSingle();
    if (dup?.id) {
      throw new Error(
        kind === "complaint"
          ? "Negative rating already recorded for this job"
          : "Positive rating already recorded for this job",
      );
    }
  }

  const { error } = await client.from("partner_feedback").insert({
    partner_id: partnerId,
    job_id: jobId,
    kind,
    source: "manual",
    notes,
    job_reference: jobReference,
    created_by: input.createdByUserId ?? null,
  });
  if (error) throw error;

  return refreshPartnerRating(partnerId, client);
}

/** @deprecated Use {@link addManualPartnerFeedback} with `kind: "praise"`. */
export async function addManualPartnerKudos(
  partnerId: string,
  input: { notes?: string; jobId?: string; createdByUserId?: string },
  supabase?: SupabaseClient,
): Promise<PartnerRatingMeta> {
  return addManualPartnerFeedback(
    partnerId,
    { ...input, kind: "praise" },
    supabase,
  );
}

/** Recompute stored ratings for partners still at legacy 0 (no events → 5). */
export async function refreshLegacyZeroPartnerRatings(partnerIds: string[]): Promise<void> {
  await Promise.all(partnerIds.map((id) => refreshPartnerRating(id).catch(() => null)));
}
