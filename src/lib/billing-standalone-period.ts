import { parseISO } from "date-fns";
import {
  currentPartnerWorkPeriod,
  workPeriodBoundsForPayoutFriday,
  type SelfBillDueResolveContext,
} from "@/lib/partner-payout-schedule";
import { getWeekBoundsForDate, weekPresetsFromYear } from "@/lib/self-bill-period";

export type BillingStandalonePeriod = "today" | "week" | "month" | "qtd";

export type YmdBounds = { from: string; to: string };

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfWeekMonday(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

export function todayYmdLocal(): string {
  return toYmd(new Date());
}

export function resolveBillingStandaloneBounds(period: BillingStandalonePeriod, anchor = new Date()): YmdBounds {
  const today = toYmd(anchor);
  if (period === "today") {
    return { from: today, to: today };
  }
  if (period === "week") {
    const mon = startOfWeekMonday(anchor);
    const sun = new Date(mon);
    sun.setDate(sun.getDate() + 6);
    return { from: toYmd(mon), to: toYmd(sun) };
  }
  if (period === "month") {
    const from = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}-01`;
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return { from, to: toYmd(last) };
  }
  // QTD — calendar quarter containing anchor
  const qStartMonth = Math.floor(anchor.getMonth() / 3) * 3;
  const from = `${anchor.getFullYear()}-${String(qStartMonth + 1).padStart(2, "0")}-01`;
  return { from, to: today };
}

export function ymdInBounds(ymd: string | null | undefined, bounds: YmdBounds): boolean {
  const s = ymd?.trim().slice(0, 10) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return s >= bounds.from && s <= bounds.to;
}

export function isoInBounds(iso: string | null | undefined, bounds: YmdBounds): boolean {
  if (!iso?.trim()) return false;
  const ymd = iso.trim().slice(0, 10);
  return ymdInBounds(ymd, bounds);
}

export function addDaysYmd(ymd: string, days: number): string {
  const d = parseYmd(ymd);
  d.setDate(d.getDate() + days);
  return toYmd(d);
}

export function daysBetweenYmd(fromYmd: string, toYmdStr: string): number {
  const p = (s: string) => {
    const [y, mo, d] = s.split("-").map(Number);
    return Date.UTC(y, mo - 1, d);
  };
  return Math.round((p(toYmdStr) - p(fromYmd)) / 86400000);
}

export const BILLING_STANDALONE_PERIOD_LABELS: Record<BillingStandalonePeriod, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  qtd: "QTD",
};

export const BILLING_STANDALONE_NET_LABELS: Record<BillingStandalonePeriod, string> = {
  today: "Net today",
  week: "Net this week",
  month: "Net this month",
  qtd: "Net QTD",
};

export const BILLING_STANDALONE_COLLECTED_LABELS: Record<BillingStandalonePeriod, string> = {
  today: "Collected today",
  week: "Collected this week",
  month: "Collected MTD",
  qtd: "Collected QTD",
};

export function invoicePaidYmd(inv: {
  paid_date?: string | null;
  last_payment_date?: string | null;
  stripe_paid_at?: string | null;
}): string {
  return (inv.paid_date ?? inv.last_payment_date ?? inv.stripe_paid_at ?? "").slice(0, 10);
}

export function invoiceDueYmd(inv: { due_date?: string | null }): string {
  return inv.due_date?.trim().slice(0, 10) ?? "";
}

/** Inclusive overlap: [aFrom,aTo] intersects [bFrom,bTo]. */
export function ymdRangesOverlap(
  aFrom: string,
  aTo: string,
  bFrom: string,
  bTo: string,
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(aFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(aTo)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(bTo)) return false;
  return aFrom <= bTo && aTo >= bFrom;
}

function boundsFromWeekLabel(label: string): YmdBounds | null {
  const normalized = label.trim();
  const m = /^(\d{4})-W\d{2}$/.exec(normalized);
  if (!m) return null;
  const presets = weekPresetsFromYear(Number(m[1]));
  const hit = presets.find((p) => p.label === normalized);
  if (!hit) return null;
  const { weekEnd } = getWeekBoundsForDate(parseISO(`${hit.weekStart}T12:00:00`));
  return { from: hit.weekStart, to: weekEnd };
}

/** Billing work week (Mon–Sun of jobs), not payment due date. */
export function selfBillWorkWeekBounds(sb: {
  week_start?: string | null;
  week_end?: string | null;
  week_label?: string | null;
}): YmdBounds | null {
  const ws = sb.week_start?.trim().slice(0, 10) ?? "";
  const we = sb.week_end?.trim().slice(0, 10) ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(ws)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(we)) return { from: ws, to: we };
    return { from: ws, to: addDaysYmd(ws, 6) };
  }
  const label = sb.week_label?.trim() ?? "";
  if (label) return boundsFromWeekLabel(label);
  return null;
}

export function selfBillWorkWeekInPeriod(
  sb: {
    week_start?: string | null;
    week_end?: string | null;
    week_label?: string | null;
  },
  periodBounds: YmdBounds,
): boolean {
  const work = selfBillWorkWeekBounds(sb);
  if (!work) return false;
  return ymdRangesOverlap(work.from, work.to, periodBounds.from, periodBounds.to);
}

/** Biweekly pay-period work range from stored `due_date` (falls back to ISO week). */
export function selfBillPayWorkPeriodBounds(sb: {
  week_start?: string | null;
  week_end?: string | null;
  week_label?: string | null;
  due_date?: string | null;
}): YmdBounds | null {
  const due = sb.due_date?.trim().slice(0, 10) ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    const period = workPeriodBoundsForPayoutFriday(due);
    return { from: period.periodStartYmd, to: period.periodEndYmd };
  }
  return selfBillWorkWeekBounds(sb);
}

export function selfBillPayWorkPeriodInPeriod(
  sb: {
    week_start?: string | null;
    week_end?: string | null;
    week_label?: string | null;
    due_date?: string | null;
  },
  periodBounds: YmdBounds,
): boolean {
  const work = selfBillPayWorkPeriodBounds(sb);
  if (!work) return false;
  return ymdRangesOverlap(work.from, work.to, periodBounds.from, periodBounds.to);
}

/** Self-bill date filter: "This week" uses current biweekly work period when configured. */
export function resolveSelfBillFilterBounds(
  period: BillingStandalonePeriod,
  dueCtx?: SelfBillDueResolveContext,
  anchor = new Date(),
): YmdBounds {
  if (period === "week" && dueCtx) {
    const today = toYmd(anchor);
    const wp = currentPartnerWorkPeriod(dueCtx.orgStandardTerms, dueCtx.orgReferenceYmd, today);
    if (wp) return { from: wp.periodStartYmd, to: wp.periodEndYmd };
  }
  return resolveBillingStandaloneBounds(period, anchor);
}

export function formatPeriodBoundsLabel(bounds: YmdBounds): string {
  if (bounds.from === bounds.to) return bounds.from;
  return `${bounds.from} – ${bounds.to}`;
}
