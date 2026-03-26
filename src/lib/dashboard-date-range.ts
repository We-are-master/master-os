/** Presets for dashboard filtering (jobs, quotes, invoices, activity). */

export type DateRangePreset = "7d" | "30d" | "90d" | "mtd" | "ytd" | "custom" | "all";

export interface DashboardDateBounds {
  fromIso: string;
  toIso: string;
}

/**
 * Inclusive calendar range in local browser TZ, returned as ISO strings for Supabase `.gte` / `.lte`.
 * `null` means no date filter (all time).
 */
export function getBoundsForPreset(
  preset: DateRangePreset,
  customFrom?: string,
  customTo?: string
): DashboardDateBounds | null {
  if (preset === "all") return null;

  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (preset === "custom") {
    if (!customFrom?.trim() || !customTo?.trim()) return null;
    const s = new Date(customFrom + "T00:00:00");
    const e = new Date(customTo + "T23:59:59.999");
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
    return { fromIso: s.toISOString(), toIso: e.toISOString() };
  }

  let start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  switch (preset) {
    case "7d":
      start.setDate(start.getDate() - 6);
      break;
    case "30d":
      start.setDate(start.getDate() - 29);
      break;
    case "90d":
      start.setDate(start.getDate() - 89);
      break;
    case "mtd":
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      break;
    case "ytd":
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      break;
    default:
      return null;
  }

  return { fromIso: start.toISOString(), toIso: end.toISOString() };
}

export const PRESET_OPTIONS: { id: DateRangePreset; label: string }[] = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "mtd", label: "Month to date" },
  { id: "ytd", label: "Year to date" },
  { id: "custom", label: "Custom" },
  { id: "all", label: "All time" },
];

export function formatRangeHint(bounds: DashboardDateBounds | null): string {
  if (!bounds) return "All time";
  try {
    const a = new Date(bounds.fromIso);
    const b = new Date(bounds.toIso);
    return `${a.toLocaleDateString(undefined, { dateStyle: "medium" })} – ${b.toLocaleDateString(undefined, { dateStyle: "medium" })}`;
  } catch {
    return "";
  }
}
