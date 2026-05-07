import {
  biddingSlaMsFromHours,
  DEFAULT_FRONTEND_SETUP,
  resolveBiddingSlaHours,
} from "@/lib/frontend-setup";
import type { Quote } from "@/types/database";

/** @deprecated Use dynamic SLA from company settings */
export const DEFAULT_BIDDING_SLA_MS = biddingSlaMsFromHours(resolveBiddingSlaHours(DEFAULT_FRONTEND_SETUP));

/** Fields needed to resolve SLA start (stored or legacy fallback). */
export type BiddingSlaAnchorQuote = Pick<Quote, "status" | "bidding_started_at" | "updated_at" | "created_at">;

/**
 * When `bidding_started_at` is missing (pre-migration / no audit), approximate from last activity
 * so older open bidding rows still show a countdown — same order as DB backfill.
 */
export function biddingQuoteSlaAnchorIso(q: BiddingSlaAnchorQuote): string | null {
  if (q.status !== "bidding") return null;
  for (const c of [q.bidding_started_at, q.updated_at, q.created_at]) {
    const s = typeof c === "string" ? c.trim() : "";
    if (!s) continue;
    const t = Date.parse(s);
    if (Number.isFinite(t)) return s;
  }
  return null;
}

export function biddingQuoteSlaUsesStoredAnchor(q: BiddingSlaAnchorQuote): boolean {
  const s = q.bidding_started_at?.trim();
  return Boolean(s && Number.isFinite(Date.parse(s)));
}

export function quoteBiddingSlaDeadlineMsFromQuote(q: BiddingSlaAnchorQuote, slaMs: number): number | null {
  const anchor = biddingQuoteSlaAnchorIso(q);
  return quoteBiddingSlaDeadlineMs(anchor, slaMs);
}

export function quoteBiddingSlaDeadlineMs(
  biddingStartedAt: string | null | undefined,
  slaMs: number,
): number | null {
  if (!biddingStartedAt?.trim()) return null;
  const started = Date.parse(biddingStartedAt);
  if (!Number.isFinite(started)) return null;
  return started + slaMs;
}

/** Whole-minute countdown (no ticking seconds). */
export function formatSlaRemainCountdownMinutes(remainingMs: number): string {
  const minsTotal = Math.floor(Math.max(0, remainingMs) / 60_000);
  if (minsTotal <= 0) return "0m";
  const days = Math.floor(minsTotal / (60 * 24));
  const hours = Math.floor((minsTotal % (60 * 24)) / 60);
  const mins = minsTotal % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);
  return parts.join(" ");
}

/** Overdue duration in whole minutes. */
export function formatSlaOverdueMinutes(overdueMs: number): string {
  const minsTotal = Math.floor(Math.max(0, overdueMs) / 60_000);
  if (minsTotal <= 0) return "<1m";
  const days = Math.floor(minsTotal / (60 * 24));
  const hours = Math.floor((minsTotal % (60 * 24)) / 60);
  const mins = minsTotal % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);
  return parts.join(" ");
}

/** @deprecated Prefer minute-based countdown in UI */
export function formatSlaRemainShort(remainingMs: number): string {
  return formatSlaRemainCountdownMinutes(remainingMs);
}

/** @deprecated Prefer formatSlaOverdueMinutes */
export function formatSlaOverdueShort(overdueMs: number): string {
  return formatSlaOverdueMinutes(overdueMs);
}

/** Roll-up for all open bidding quotes. */
export type BiddingSlaRollup = {
  total: number;
  breached: number;
  missingAnchor: number;
  avgMinutesInBidding: number | null;
  maxMinutesInBidding: number | null;
};

export function computeBiddingSlaRollup(
  rows: readonly BiddingSlaAnchorQuote[],
  nowMs: number = Date.now(),
  slaMs: number,
): BiddingSlaRollup {
  let breached = 0;
  let missingAnchor = 0;
  const minutesList: number[] = [];
  let maxMin = 0;

  for (const r of rows) {
    const anchor = biddingQuoteSlaAnchorIso(r);
    if (!anchor) {
      missingAnchor++;
      continue;
    }
    const started = Date.parse(anchor);
    if (!Number.isFinite(started)) {
      missingAnchor++;
      continue;
    }
    const elapsed = nowMs - started;
    if (elapsed > slaMs) breached++;
    const min = elapsed / 60_000;
    minutesList.push(min);
    if (min > maxMin) maxMin = min;
  }

  const avg =
    minutesList.length > 0 ? minutesList.reduce((a, b) => a + b, 0) / minutesList.length : null;

  return {
    total: rows.length,
    breached,
    missingAnchor,
    avgMinutesInBidding: avg,
    maxMinutesInBidding: minutesList.length > 0 ? maxMin : null,
  };
}

/** For KPI strip: "2d 4h", "3h 12m", "45m". */
export function formatMinutesAsAge(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return "—";
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h < 48) {
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(h / 24);
  const hr = h % 24;
  return hr > 0 ? `${d}d ${hr}h` : `${d}d`;
}
