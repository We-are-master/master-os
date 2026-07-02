/**
 * Registry of lifecycle sequences. The cron engine looks sequences up by key.
 * Client (demand-side) sequences are defined here; partner sequences can be
 * added the same way later.
 *
 * Offsets are cumulative from `enrolled_at`. Conversion events (e.g. a booking)
 * should mark the nurture enrollment `converted` via markConverted() and may
 * enroll the contact into the next sequence (post-booking, post-job, …).
 */

import type { SequenceDefinition } from "./types";
import * as C from "./client-templates";
import * as X from "./cold-templates";

const D = 24;

/** C1–C5 — pre-booking nurture. Stops the moment a booking is made. */
const CLIENT_DEMAND_NURTURE: SequenceDefinition = {
  key: "client_demand_nurture",
  label: "Client · demand nurture",
  steps: [
    { key: "welcome",       offsetHours: 0,       subject: () => "We've got your request — let's get you booked", html: C.clientWelcomeQuote },
    { key: "social_proof",  offsetHours: 1 * D,   subject: () => "Trusted by homeowners near you", html: C.clientSocialProof },
    { key: "transparency",  offsetHours: 3 * D,   subject: () => "No call-out surprises — see your price", html: C.clientTransparency },
    { key: "incentive",     offsetHours: 5 * D,   subject: (ctx) => `${ctx.amount ?? "£20"} off your first Fixfy job`, html: C.clientIncentive },
    { key: "breakup",       offsetHours: 8 * D,   subject: () => "Still need a hand? (last nudge)", html: C.clientBreakup },
  ],
};

/** C6 — transactional booking confirmation (single send). */
const CLIENT_BOOKING_CONFIRMED: SequenceDefinition = {
  key: "client_booking_confirmed",
  label: "Client · booking confirmed",
  steps: [
    { key: "confirmed", offsetHours: 0, subject: () => "You're booked in with Fixfy", html: C.clientBookingConfirmed },
  ],
};

/** C7–C8 — after the job: review then cross-sell. Enroll on job completion. */
const CLIENT_POST_JOB: SequenceDefinition = {
  key: "client_post_job",
  label: "Client · post-job",
  steps: [
    { key: "review",    offsetHours: 1 * D,  subject: () => "How did your Fixfy job go?", html: C.clientReviewRequest },
    { key: "crosssell", offsetHours: 14 * D, subject: () => "What's next for your home?", html: C.clientCrossSell },
  ],
};

/**
 * C9 — seasonal / certificate reminder. Recurring: after it sends, it loops
 * back and schedules the next cycle `recurEveryHours` later. Default 365 days
 * (annual cert); override per-enrollment by setting next_send_at + a shorter
 * recurEveryHours sequence if you need quarterly/seasonal cadence.
 * This is the engine that makes the funnel "infinite".
 */
const CLIENT_SEASONAL: SequenceDefinition = {
  key: "client_seasonal",
  label: "Client · seasonal reminder (recurring)",
  recurring: true,
  recurEveryHours: 365 * D,
  steps: [
    { key: "reminder", offsetHours: 0, subject: (ctx) => `Time for ${ctx.reminderLabel ?? "your next service"}`, html: C.clientSeasonalReminder },
  ],
};

/** C10 — win-back for lapsed customers (single send; re-enroll periodically). */
const CLIENT_WINBACK: SequenceDefinition = {
  key: "client_winback",
  label: "Client · win-back",
  steps: [
    { key: "winback", offsetHours: 0, subject: (ctx) => `We've missed you — ${ctx.amount ?? "£25"} to come back`, html: C.clientWinback },
  ],
};

/* ===== Cold outbound (Apify-sourced, B2B). Always carry unsubscribeUrl. ===== */

/** Recruit tradespeople scraped from Google Maps / directories. */
const PARTNER_COLD: SequenceDefinition = {
  key: "partner_cold",
  label: "Partner · cold outbound",
  steps: [
    { key: "intro",       offsetHours: 0,     subject: (ctx) => `Steady work${ctx.town ? ` in ${ctx.town}` : ""} — no leads to chase`, html: X.partnerColdIntro },
    { key: "how_it_works",offsetHours: 3 * D, subject: () => "How Fixfy works for pros (60 seconds)", html: X.partnerColdHowItWorks },
    { key: "breakup",     offsetHours: 7 * D, subject: () => "Last one — should I keep your spot?", html: X.partnerColdBreakup },
  ],
};

/** Pitch estate/letting agents & property managers scraped via Apify. */
const B2B_CLIENT_COLD: SequenceDefinition = {
  key: "b2b_client_cold",
  label: "B2B client · cold outbound",
  steps: [
    { key: "intro",   offsetHours: 0,     subject: () => "One vetted partner for all your property jobs", html: X.b2bClientColdIntro },
    { key: "value",   offsetHours: 4 * D, subject: () => "Cut the admin around property maintenance", html: X.b2bClientColdValue },
    { key: "breakup", offsetHours: 8 * D, subject: () => "Worth a quick chat?", html: X.b2bClientColdBreakup },
  ],
};

export const SEQUENCES: Record<string, SequenceDefinition> = {
  [CLIENT_DEMAND_NURTURE.key]: CLIENT_DEMAND_NURTURE,
  [CLIENT_BOOKING_CONFIRMED.key]: CLIENT_BOOKING_CONFIRMED,
  [CLIENT_POST_JOB.key]: CLIENT_POST_JOB,
  [CLIENT_SEASONAL.key]: CLIENT_SEASONAL,
  [CLIENT_WINBACK.key]: CLIENT_WINBACK,
  [PARTNER_COLD.key]: PARTNER_COLD,
  [B2B_CLIENT_COLD.key]: B2B_CLIENT_COLD,
};

/** Maps a lead segment to its cold-outbound sequence. */
export const COLD_SEQUENCE_BY_SEGMENT: Record<"partner" | "b2b_client", string> = {
  partner: PARTNER_COLD.key,
  b2b_client: B2B_CLIENT_COLD.key,
};

export function getSequence(key: string): SequenceDefinition | null {
  return SEQUENCES[key] ?? null;
}
