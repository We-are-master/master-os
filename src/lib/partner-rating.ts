import type { JobStatus } from "@/types/database";

/** Maximum partner score (stars). */
export const PARTNER_RATING_MAX = 5;

/** Points deducted per partner-fault complaint (≈10% of max). */
export const PARTNER_COMPLAINT_PENALTY_POINTS = 0.5;

/** Points added per praise event (customer review 4+ or manual kudos). */
export const PARTNER_PRAISE_POINTS = 0.25;

/** Minimum customer review (1–5) that earns automatic praise. */
export const PARTNER_PRAISE_REVIEW_MIN = 4;

export type PartnerFeedbackKind = "complaint" | "praise";
export type PartnerFeedbackSource = "job_on_hold" | "customer_review" | "manual";

export type PartnerFeedbackEvent = {
  kind: PartnerFeedbackKind;
  source: PartnerFeedbackSource;
  /** Current job status when kind = complaint (affects penalty multiplier). */
  jobStatus?: JobStatus | null;
};

/** @deprecated Use {@link PartnerFeedbackEvent} via partner_feedback table. */
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

export function feedbackEventPoints(event: PartnerFeedbackEvent): number {
  if (event.kind === "praise") return PARTNER_PRAISE_POINTS;
  const status = event.jobStatus ?? "on_hold";
  return -PARTNER_COMPLAINT_PENALTY_POINTS * complaintPenaltyMultiplier(status);
}

export function computePartnerRatingFromFeedback(events: readonly PartnerFeedbackEvent[]): number {
  let delta = 0;
  for (const event of events) {
    delta += feedbackEventPoints(event);
  }
  const raw = PARTNER_RATING_MAX + delta;
  return clampPartnerRating(raw);
}

function clampPartnerRating(raw: number): number {
  return Math.max(0, Math.min(PARTNER_RATING_MAX, Math.round(raw * 10) / 10));
}

/** @deprecated Prefer {@link computePartnerRatingFromFeedback}. */
export function computePartnerRatingFromComplaints(complaints: readonly PartnerComplaintJob[]): number {
  const events: PartnerFeedbackEvent[] = complaints.map((row) => ({
    kind: "complaint",
    source: "job_on_hold",
    jobStatus: row.status,
  }));
  return computePartnerRatingFromFeedback(events);
}

/** UI / list display when DB rating is unset (legacy rows). */
export function displayPartnerRating(rating: number | null | undefined): number {
  if (rating == null || Number.isNaN(rating)) return PARTNER_RATING_MAX;
  return rating;
}

export type PartnerRatingBreakdown = {
  rating: number;
  complaintCount: number;
  pointsLost: number;
  praiseCount: number;
  pointsGained: number;
};

export function partnerRatingBreakdown(events: readonly PartnerFeedbackEvent[]): PartnerRatingBreakdown {
  let pointsLost = 0;
  let pointsGained = 0;
  let complaintCount = 0;
  let praiseCount = 0;

  for (const event of events) {
    const pts = feedbackEventPoints(event);
    if (event.kind === "complaint") {
      complaintCount += 1;
      pointsLost += Math.abs(pts);
    } else {
      praiseCount += 1;
      pointsGained += pts;
    }
  }

  return {
    rating: clampPartnerRating(
      PARTNER_RATING_MAX + pointsGained - pointsLost,
    ),
    complaintCount,
    pointsLost: Math.round(pointsLost * 10) / 10,
    praiseCount,
    pointsGained: Math.round(pointsGained * 10) / 10,
  };
}

export function partnerFeedbackSourceLabel(source: PartnerFeedbackSource): string {
  switch (source) {
    case "job_on_hold":
      return "Complaint";
    case "customer_review":
      return "Customer review";
    case "manual":
      return "Kudos";
    default:
      return source;
  }
}
