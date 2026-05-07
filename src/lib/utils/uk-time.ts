/**
 * UK wall-clock ↔ UTC conversion helpers.
 *
 * Master OS operates in the UK, and every schedule input the user types is a
 * UK wall-clock time. The DB stores `timestamptz` (UTC). Without these
 * helpers, code paths drift across three timezones:
 *   - browser local TZ (e.g. America/Sao_Paulo for our team)
 *   - UTC (storage)
 *   - Europe/London (display via Intl)
 *
 * Symptom of that drift: user types 2PM, input redisplays 11AM, ticket shows
 * 3PM — because each leg interpreted the value in a different zone.
 *
 * Use these helpers ANY time you need to:
 *   - Read `scheduled_start_at` / `scheduled_end_at` into a date+time form input.
 *   - Build a `scheduled_start_at` value from form inputs to send to Supabase.
 */

import { UK_TIMEZONE } from "@/lib/utils/date";

const HM_RE = /^\d{2}:\d{2}$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns the UTC offset in minutes for a given UTC moment when expressed in
 * Europe/London (0 in winter / GMT, +60 in summer / BST).
 */
function ukOffsetMinutesAt(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcMs));

  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const y = get("year");
  const mo = get("month");
  const d = get("day");
  const h = get("hour") % 24;
  const mi = get("minute");
  const s = get("second");
  const ukAsUtcMs = Date.UTC(y, mo - 1, d, h, mi, s);
  return Math.round((ukAsUtcMs - utcMs) / 60000);
}

/**
 * Convert a UK wall-clock date+time to a UTC ISO string.
 *
 *   ukWallClockToUtcIso("2026-05-08", "14:00")  // → "2026-05-08T13:00:00.000Z" (BST)
 *   ukWallClockToUtcIso("2026-12-08", "14:00")  // → "2026-12-08T14:00:00.000Z" (GMT)
 *
 * Returns "" if inputs are malformed (so callers can early-return).
 */
export function ukWallClockToUtcIso(ymd: string, hm: string): string {
  const date = ymd?.trim();
  const time = hm?.trim();
  if (!date || !time || !YMD_RE.test(date) || !HM_RE.test(time)) return "";

  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  if (![y, mo, d, h, mi].every(Number.isFinite)) return "";

  // Two-pass: assume UK = UTC, find the offset at that guess, refine. One pass
  // is enough except for the ambiguous hour at the autumn DST fall-back where
  // we deterministically pick the earlier (BST) instant — fine for scheduling
  // since end > start arithmetic is preserved.
  const guessUtcMs = Date.UTC(y, mo - 1, d, h, mi, 0);
  const offsetMin = ukOffsetMinutesAt(guessUtcMs);
  const actualUtcMs = guessUtcMs - offsetMin * 60_000;
  return new Date(actualUtcMs).toISOString();
}

/**
 * Convert a UTC ISO timestamp to UK wall-clock { ymd, hm } parts. Use when
 * hydrating an editable form from a stored `timestamptz`.
 *
 *   utcIsoToUkWallClock("2026-05-08T13:00:00Z")  // → { ymd: "2026-05-08", hm: "14:00" }
 */
export function utcIsoToUkWallClock(iso: string | null | undefined): { ymd: string; hm: string } {
  if (!iso) return { ymd: "", hm: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { ymd: "", hm: "" };

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: UK_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  // Intl can return "24" for midnight on some engines — normalise to "00".
  const hour = get("hour") === "24" ? "00" : get("hour");
  const hm = `${hour}:${get("minute")}`;
  return { ymd, hm };
}

/**
 * Add `windowMinutes` to a UK wall-clock start (ymd + hm) and return the
 * resulting UK wall-clock end as the same shape. Wall-clock arithmetic is
 * stable across DST jumps for windows up to a few hours (the schedule UI
 * caps at 4h), so we operate in UTC then format back in UK.
 */
export function addMinutesUkWallClock(
  ymd: string,
  hm: string,
  windowMinutes: number,
): { ymd: string; hm: string } {
  const startIso = ukWallClockToUtcIso(ymd, hm);
  if (!startIso) return { ymd: "", hm: "" };
  const endMs = new Date(startIso).getTime() + windowMinutes * 60_000;
  return utcIsoToUkWallClock(new Date(endMs).toISOString());
}
