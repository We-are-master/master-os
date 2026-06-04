import type { JobStatus } from "@/types/database";

/** Maximum partner score (stars). */
export const PARTNER_RATING_MAX = 5;

/**
 * Points deducted per partner-fault complaint (≈10% of max).
 * Outcome multipliers apply on top (see {@link complaintPenaltyMultiplier}).
 */
export const PARTNER_COMPLAINT_PENALTY_POINTS = 0.5;

export type PartnerComplaintJob = {
  status: JobStatus;
};

/**
 * How much of {@link PARTNER_COMPLAINT_PENALTY_POINTS} applies for this job outcome.
 * - Cancelled: full penalty
 * - Completed (sorted & closed): half penalty
 * - Other (on hold, in progress, etc.): full penalty while complaint stands
 */
export function complaintPenaltyMultiplier(status: JobStatus): number {
  if (status === "cancelled") return 1;
  if (status === "completed") return 0.5;
  return 1;
}

export function computePartnerRatingFromComplaints(complaints: readonly PartnerComplaintJob[]): number {
  let deduction = 0;
  for (const row of complaints) {
    deduction += PARTNER_COMPLAINT_PENALTY_POINTS * complaintPenaltyMultiplier(row.status);
  }
  const raw = PARTNER_RATING_MAX - deduction;
  return Math.max(0, Math.round(raw * 10) / 10);
}

/** UI / list display when DB rating is unset (legacy rows). */
export function displayPartnerRating(rating: number | null | undefined): number {
  if (rating == null || Number.isNaN(rating)) return PARTNER_RATING_MAX;
  return rating;
}

export function partnerRatingBreakdown(complaints: readonly PartnerComplaintJob[]): {
  rating: number;
  complaintCount: number;
  pointsLost: number;
} {
  let deduction = 0;
  for (const row of complaints) {
    deduction += PARTNER_COMPLAINT_PENALTY_POINTS * complaintPenaltyMultiplier(row.status);
  }
  const roundedDeduction = Math.round(deduction * 10) / 10;
  return {
    rating: Math.max(0, Math.round((PARTNER_RATING_MAX - deduction) * 10) / 10),
    complaintCount: complaints.length,
    pointsLost: roundedDeduction,
  };
}
