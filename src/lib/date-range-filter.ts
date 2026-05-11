/**
 * Unified date filter primitives shared across Pulse, Live View, Jobs, Quotes,
 * and Schedule. Single source of truth for the 6 canonical modes so adding /
 * tweaking a mode happens in one place.
 *
 * Why a fresh module instead of extending `dashboard-date-range.ts`: that one
 * carries legacy presets (7d/30d/90d/ytd) that we don't want surfacing here.
 * The shared filter intentionally exposes just 6 user-facing modes.
 */

export type DateFilterMode = "today" | "tomorrow" | "week" | "month" | "qtd" | "custom";

export type DateFilterValue = {
  mode: DateFilterMode;
  /** YYYY-MM-DD inputs (only meaningful when `mode === "custom"`). */
  customFrom?: string;
  customTo?: string;
};

export const DEFAULT_DATE_FILTER: DateFilterValue = {
  mode: "today",
  customFrom: "",
  customTo: "",
};

/** Inclusive ISO bounds in local browser TZ. `null` means custom range incomplete. */
export type DateFilterBounds = { fromIso: string; toIso: string };

export const DATE_FILTER_QUICK_OPTIONS: { id: Exclude<DateFilterMode, "custom">; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "qtd", label: "QTD" },
];

export function resolveDateFilter(value: DateFilterValue): DateFilterBounds | null {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  switch (value.mode) {
    case "today":
      return { fromIso: startOfToday.toISOString(), toIso: endOfToday.toISOString() };
    case "tomorrow": {
      const s = new Date(startOfToday);
      s.setDate(s.getDate() + 1);
      const e = new Date(endOfToday);
      e.setDate(e.getDate() + 1);
      return { fromIso: s.toISOString(), toIso: e.toISOString() };
    }
    case "week": {
      // ISO-style week (Mon–Sun) containing today.
      const day = startOfToday.getDay() || 7;
      const s = new Date(startOfToday);
      s.setDate(s.getDate() - (day - 1));
      const e = new Date(s);
      e.setDate(e.getDate() + 6);
      e.setHours(23, 59, 59, 999);
      return { fromIso: s.toISOString(), toIso: e.toISOString() };
    }
    case "month": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { fromIso: s.toISOString(), toIso: e.toISOString() };
    }
    case "qtd": {
      const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
      const s = new Date(now.getFullYear(), qStartMonth, 1, 0, 0, 0, 0);
      return { fromIso: s.toISOString(), toIso: endOfToday.toISOString() };
    }
    case "custom": {
      const from = value.customFrom?.trim();
      const to = value.customTo?.trim();
      if (!from || !to) return null;
      const s = new Date(from + "T00:00:00");
      const e = new Date(to + "T23:59:59.999");
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
      return { fromIso: s.toISOString(), toIso: e.toISOString() };
    }
  }
}

/** Pad-to-YYYY-MM-DD using local timezone (avoids the UTC-shift gotcha at month boundaries). */
export function localYmd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dateFilterLabel(value: DateFilterValue): string {
  if (value.mode === "custom") {
    const bounds = resolveDateFilter(value);
    if (!bounds) return "Custom";
    const a = new Date(bounds.fromIso).toLocaleDateString(undefined, { dateStyle: "medium" });
    const b = new Date(bounds.toIso).toLocaleDateString(undefined, { dateStyle: "medium" });
    return `${a} – ${b}`;
  }
  return DATE_FILTER_QUICK_OPTIONS.find((o) => o.id === value.mode)?.label ?? "";
}
