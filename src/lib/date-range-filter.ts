/**
 * Unified date filter primitives shared across Pulse, Live View, Jobs, Quotes,
 * and Schedule. Single source of truth for the canonical modes so adding /
 * tweaking a mode happens in one place.
 *
 * Why a fresh module instead of extending `dashboard-date-range.ts`: that one
 * carries legacy presets (7d/30d/90d/ytd) that we don't want surfacing here.
 */

export type DateFilterMode =
  | "all"
  | "today"
  | "yesterday"
  | "tomorrow"
  | "week"
  | "next_week"
  | "month"
  | "qtd"
  | "last_month"
  | "next_month"
  | "custom";

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

export type DateFilterQuickOption = { id: Exclude<DateFilterMode, "custom">; label: string };

/**
 * Menu order for the compact picker. Every window lives in here, including
 * Today: the chip beside the menu shows whichever one is active, so the menu
 * stays the single place a period is chosen.
 */
export const DATE_FILTER_MENU_OPTIONS: DateFilterQuickOption[] = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "week", label: "This week" },
  { id: "next_week", label: "Next week" },
  { id: "month", label: "This month" },
  { id: "next_month", label: "Next month" },
];

/**
 * Modes the picker does not offer but callers can still hold (a saved filter,
 * a link, another screen's preset). Kept so `dateFilterLabel` never renders an
 * empty chip for a value the menu happens not to list.
 */
const DATE_FILTER_EXTRA_LABELS: DateFilterQuickOption[] = [
  { id: "qtd", label: "Quarter to date" },
  { id: "last_month", label: "Last month" },
];

export function resolveDateFilter(value: DateFilterValue): DateFilterBounds | null {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  switch (value.mode) {
    case "all":
      return null;
    case "today":
      return { fromIso: startOfToday.toISOString(), toIso: endOfToday.toISOString() };
    case "yesterday": {
      const s = new Date(startOfToday);
      s.setDate(s.getDate() - 1);
      const e = new Date(endOfToday);
      e.setDate(e.getDate() - 1);
      return { fromIso: s.toISOString(), toIso: e.toISOString() };
    }
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
    case "next_week": {
      // Monday of next week through the Sunday that closes it.
      const day = startOfToday.getDay() || 7;
      const s = new Date(startOfToday);
      s.setDate(s.getDate() - (day - 1) + 7);
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
    case "last_month": {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      const e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { fromIso: s.toISOString(), toIso: e.toISOString() };
    }
    case "next_month": {
      const s = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
      const e = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
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
    // "On" (single day) is stored as from === to — show one date, not "x – x".
    return a === b ? a : `${a} – ${b}`;
  }
  // The menu is the source of truth for labels, so the chip reads exactly like
  // the row the operator picked.
  return (
    DATE_FILTER_MENU_OPTIONS.find((o) => o.id === value.mode)?.label ??
    DATE_FILTER_EXTRA_LABELS.find((o) => o.id === value.mode)?.label ??
    ""
  );
}
