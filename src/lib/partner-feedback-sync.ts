import type { SupabaseClient } from "@supabase/supabase-js";
import { PARTNER_PRAISE_REVIEW_MIN } from "@/lib/partner-rating";
import { refreshPartnerRating } from "@/services/partner-rating";
import type { Job } from "@/types/database";

export type PartnerFeedbackJobSlice = Pick<
  Job,
  | "id"
  | "partner_id"
  | "reference"
  | "status"
  | "on_hold_reason_preset_id"
  | "on_hold_complaint_description"
  | "on_hold_reason"
  | "customer_review_rating"
  | "deleted_at"
>;

async function upsertJobFeedback(
  supabase: SupabaseClient,
  row: {
    partner_id: string;
    job_id: string;
    kind: "complaint" | "praise";
    source: "job_on_hold" | "customer_review";
    notes?: string | null;
    job_reference?: string | null;
  },
): Promise<void> {
  const { data: existing } = await supabase
    .from("partner_feedback")
    .select("id")
    .eq("partner_id", row.partner_id)
    .eq("job_id", row.job_id)
    .eq("kind", row.kind)
    .eq("source", row.source)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from("partner_feedback")
      .update({
        notes: row.notes ?? null,
        job_reference: row.job_reference ?? null,
      })
      .eq("id", existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("partner_feedback").insert(row);
  if (error?.code === "23505") return;
  if (error) throw error;
}

/**
 * Keep partner_feedback in sync when job complaint / review fields change,
 * then recompute partners.rating.
 */
export async function syncPartnerFeedbackFromJob(
  supabase: SupabaseClient,
  job: PartnerFeedbackJobSlice,
): Promise<void> {
  const partnerId = job.partner_id?.trim();
  if (!partnerId || job.deleted_at) return;

  if ((job.on_hold_reason_preset_id ?? "").trim() === "complaint") {
    const notes =
      job.on_hold_complaint_description?.trim() ||
      job.on_hold_reason?.trim() ||
      null;
    await upsertJobFeedback(supabase, {
      partner_id: partnerId,
      job_id: job.id,
      kind: "complaint",
      source: "job_on_hold",
      notes,
      job_reference: job.reference ?? null,
    });
  }

  const review = job.customer_review_rating;
  if (
    job.status === "completed" &&
    review != null &&
    Number.isFinite(review) &&
    review >= PARTNER_PRAISE_REVIEW_MIN
  ) {
    await upsertJobFeedback(supabase, {
      partner_id: partnerId,
      job_id: job.id,
      kind: "praise",
      source: "customer_review",
      notes: `Customer review ${review}/5`,
      job_reference: job.reference ?? null,
    });
  }

  await refreshPartnerRating(partnerId, supabase);
}
