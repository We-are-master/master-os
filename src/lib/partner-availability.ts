// Day/working-hours availability check for partner↔job auto-assign matching.
//
// A partner with no availability configured is treated as AVAILABLE — we don't
// over-filter while most partners haven't set their hours yet. When a partner
// HAS configured availability, an auto-assign offer only reaches them if the
// job's UK weekday is switched on and (when the booking time is known) falls
// within that day's working hours.
//
// Times are interpreted in UK wall-clock (Europe/London), matching how the
// Trade Portal availability editor presents them.

type DayAvail = { on?: boolean; start?: string | null; end?: string | null };

export interface PartnerAvailability {
  days?: Partial<Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", DayAvail>>;
  [k: string]: unknown;
}

export interface JobSlot {
  /** YYYY-MM-DD (UK date). Used when no precise start time is known. */
  scheduledDate?: string | null;
  /** ISO timestamptz of the booking start (preferred). */
  startAt?: string | null;
  /** ISO timestamptz of the booking end. */
  endAt?: string | null;
}

const LONDON = "Europe/London";

function londonWeekdayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: LONDON })
    .format(d)
    .toLowerCase()
    .slice(0, 3);
}

function londonMinutes(d: Date): number {
  const hhmm = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: LONDON,
  }).format(d);
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function hhmmToMinutes(s?: string | null): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * True if the partner can take a job in the given slot.
 *  - No availability / no days config → available (don't over-filter).
 *  - No usable schedule on the slot → available (can't evaluate).
 *  - Otherwise the slot's UK weekday must be `on`, and when both the day hours
 *    and the booking time are known, the booking must fall within them.
 */
export function partnerAvailableForSlot(
  availability: PartnerAvailability | null | undefined,
  slot: JobSlot,
): boolean {
  const days = availability?.days;
  if (!days || typeof days !== "object") return true;

  let weekdayKey: string | null = null;
  let startMin: number | null = null;
  let endMin: number | null = null;

  if (slot.startAt) {
    const start = new Date(slot.startAt);
    if (!Number.isNaN(start.getTime())) {
      weekdayKey = londonWeekdayKey(start);
      startMin = londonMinutes(start);
      if (slot.endAt) {
        const end = new Date(slot.endAt);
        if (!Number.isNaN(end.getTime())) endMin = londonMinutes(end);
      }
    }
  } else if (slot.scheduledDate) {
    // Noon UTC keeps us on the same calendar day in UK time regardless of DST.
    const d = new Date(`${slot.scheduledDate}T12:00:00Z`);
    if (!Number.isNaN(d.getTime())) weekdayKey = londonWeekdayKey(d);
  }

  if (!weekdayKey) return true; // nothing to evaluate → don't filter

  const day = (days as Record<string, DayAvail>)[weekdayKey];
  if (!day || day.on !== true) return false;

  // Time-window check only when we know both the booking time and the day hours.
  const dayStart = hhmmToMinutes(day.start);
  const dayEnd = hhmmToMinutes(day.end);
  if (startMin != null && dayStart != null && dayEnd != null) {
    const bookingEnd = endMin ?? startMin;
    if (startMin < dayStart || bookingEnd > dayEnd) return false;
  }

  return true;
}
