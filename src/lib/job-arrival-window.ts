/** Preset lengths for arrival window end = start + N minutes (supports crossing midnight). */
export const ARRIVAL_WINDOW_OPTIONS = [
  { value: "", label: "Select length…" },
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "45", label: "45 minutes" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1.5 hours" },
  { value: "120", label: "2 hours" },
  { value: "180", label: "3 hours" },
  { value: "240", label: "4 hours" },
] as const;

/**
 * Fixed arrival slots for one-off jobs. Backed by the same `arrival_from` +
 * `arrival_window_mins` columns — picking a slot just sets both at once, so
 * the schema, partner app, calendar, and SLA all keep working unchanged.
 */
export type ArrivalSlotId = "morning" | "early_afternoon" | "afternoon" | "evening";

export const ARRIVAL_SLOTS: { id: ArrivalSlotId; label: string; from: string; mins: number }[] = [
  { id: "morning",         label: "09AM–12PM", from: "09:00", mins: 180 },
  { id: "early_afternoon", label: "01PM–03PM", from: "13:00", mins: 120 },
  { id: "afternoon",       label: "03PM–06PM", from: "15:00", mins: 180 },
  { id: "evening",         label: "06PM–08PM", from: "18:00", mins: 120 },
];

/** Map a stored (from, mins) pair back to a slot id — exact match only. */
export function matchArrivalSlot(from: string, mins: string | number): ArrivalSlotId | null {
  const m = typeof mins === "string" ? Number(mins) : mins;
  if (!Number.isFinite(m)) return null;
  const slot = ARRIVAL_SLOTS.find((s) => s.from === from && s.mins === m);
  return slot?.id ?? null;
}

/** Canonical (from, mins) for a fixed slot — use when hydrating slot UI from stored timestamps. */
export function canonicalArrivalSlotValues(
  from: string,
  mins: string | number,
): { from: string; mins: string } {
  const slotId = matchArrivalSlot(from, mins) ?? nearestArrivalSlot(from, mins);
  const slot = ARRIVAL_SLOTS.find((s) => s.id === slotId);
  if (!slot) return { from, mins: String(mins) };
  return { from: slot.from, mins: String(slot.mins) };
}

/** Closest-fit slot for legacy values that don't exactly match an option. */
export function nearestArrivalSlot(from: string, mins: string | number): ArrivalSlotId {
  const m = typeof mins === "string" ? Number(mins) || 0 : mins || 0;
  const [hh, mm] = from.split(":").map(Number);
  const startMinutes = (Number.isFinite(hh) ? hh : 9) * 60 + (Number.isFinite(mm) ? mm : 0);
  let best: ArrivalSlotId = "morning";
  let bestDist = Infinity;
  for (const slot of ARRIVAL_SLOTS) {
    const [shh, smm] = slot.from.split(":").map(Number);
    const slotStart = shh * 60 + smm;
    const dist = Math.abs(slotStart - startMinutes) + Math.abs(slot.mins - m) / 4;
    if (dist < bestDist) {
      bestDist = dist;
      best = slot.id;
    }
  }
  return best;
}

const ALLOWED_MINS = [15, 30, 45, 60, 90, 120, 180, 240];

/** Pick closest preset for hydrating the arrival-window dropdown from stored start/end. */
export function snapArrivalWindowMinutes(startMs: number, endMs: number): string {
  const mins = Math.round((endMs - startMs) / 60000);
  if (!Number.isFinite(mins) || mins <= 0) return "";
  if (mins > 240) return "240";
  const best = ALLOWED_MINS.reduce((a, b) => (Math.abs(b - mins) < Math.abs(a - mins) ? b : a));
  return String(best);
}

export function scheduledEndFromWindow(scheduledDate: string, fromHm: string, windowMinutes: number): string {
  const [yy, mo, dd] = scheduledDate.split("-").map(Number);
  const [hh, mi] = fromHm.split(":").map(Number);
  const start = new Date(yy, mo - 1, dd, hh, mi, 0);
  const end = new Date(start.getTime() + windowMinutes * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}:00`;
}
