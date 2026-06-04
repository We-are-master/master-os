import { getSupabase } from "./base";
import {
  computePartnerRatingFromComplaints,
  partnerRatingBreakdown,
  type PartnerComplaintJob,
} from "@/lib/partner-rating";
import { updatePartner } from "./partners";
import type { JobStatus } from "@/types/database";

/** Jobs where a customer complaint was raised (partner on hold preset). */
export async function listPartnerComplaintJobs(partnerId: string): Promise<PartnerComplaintJob[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .select("status")
    .eq("partner_id", partnerId)
    .eq("on_hold_reason_preset_id", "complaint")
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? []).map((r) => ({ status: (r as { status: JobStatus }).status }));
}

export async function computePartnerRatingForPartnerId(partnerId: string): Promise<number> {
  const rows = await listPartnerComplaintJobs(partnerId);
  return computePartnerRatingFromComplaints(rows);
}

export async function refreshPartnerRating(partnerId: string): Promise<{
  rating: number;
  complaintCount: number;
  pointsLost: number;
}> {
  const rows = await listPartnerComplaintJobs(partnerId);
  const breakdown = partnerRatingBreakdown(rows);
  await updatePartner(partnerId, { rating: breakdown.rating });
  return breakdown;
}

/** Recompute stored ratings for partners still at legacy 0 (no complaints → 5). */
export async function refreshLegacyZeroPartnerRatings(partnerIds: string[]): Promise<void> {
  await Promise.all(partnerIds.map((id) => refreshPartnerRating(id).catch(() => null)));
}
