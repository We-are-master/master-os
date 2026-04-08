/** Presets for dashboard filtering (jobs, quotes, invoices, activity). */

export type DateRangePreset =
  | "1d"
  | "wtd"
  | "7d"
  | "30d"
  | "90d"
  | "mtd"
  | "qtd"
  | "ytd"
  | "custom"
  | "all";

export interface DashboardDateBounds {
  fromIso: string;
  toIso: string;
}

/**
 * Inclusive **calendar** days (YYYY-MM-DD) matching the user’s local timezone.
 * Use this when comparing to DB date fields stored as civil dates (`due_date`, `payment_date`, …),
 * not `bounds.*.slice(0, 10)` on UTC ISO strings (that can shift the day at month boundaries).
 */
export function dashboardBoundsToInclusiveLocalYmd(bounds: DashboardDateBounds): { fromDay: string; toDay: string } {
  const from = new Date(bounds.fromIso);
  const to = new Date(bounds.toIso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { fromDay: ymd(from), toDay: ymd(to) };
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
  let end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (preset === "custom") {
    if (!customFrom?.trim() || !customTo?.trim()) return null;
    const s = new Date(customFrom + "T00:00:00");
    const e = new Date(customTo + "T23:59:59.999");
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
    return { fromIso: s.toISOString(), toIso: e.toISOString() };
  }

  let start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  switch (preset) {
    case "1d":
      /* Today only — same as start */
      break;
    case "wtd": {
      const day = start.getDay();
      const diff = day === 0 ? 6 : day - 1;
      start.setDate(start.getDate() - diff);
      break;
    }
    case "qtd": {
      const m = now.getMonth();
      const qStartMonth = Math.floor(m / 3) * 3;
      start = new Date(now.getFullYear(), qStartMonth, 1, 0, 0, 0, 0);
      break;
    }
    case "7d":
      start.setDate(start.getDate() - 6);
      break;
    case "30d":
      start.setDate(start.getDate() - 29);
      break;
    case "90d":
      start.setDate(start.getDate() - 89);
      break;
    case "mtd": {
      /** Full calendar month (not month-to-date through today). */
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      break;
    }
    case "ytd":
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      break;
    default:
      return null;
  }

  return { fromIso: start.toISOString(), toIso: end.toISOString() };
}

/**
 * Local calendar month (1st 00:00 → last day 23:59:59.999), same span as the “This month (full)” preset.
 * Used for Overview revenue KPIs (booked in month) independent of the global dashboard range.
 */
export function getLocalCalendarMonthDashboardBounds(now = new Date()): DashboardDateBounds {
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  return { fromIso: start.toISOString(), toIso: end.toISOString() };
}

export const PRESET_OPTIONS: { id: DateRangePreset; label: string }[] = [
  { id: "1d", label: "Today" },
  { id: "wtd", label: "Week to date" },
  { id: "mtd", label: "This month (full)" },
  { id: "qtd", label: "Quarter to date" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "ytd", label: "Year to date" },
  { id: "custom", label: "Custom range" },
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
