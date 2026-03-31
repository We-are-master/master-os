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
