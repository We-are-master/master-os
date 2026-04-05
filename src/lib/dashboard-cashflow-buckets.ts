/** Shared cashflow bucketing for dashboard (week / month). */

export interface CashflowBucketRow {
  label: string;
  /** ISO week start (YYYY-MM-DD) when granularity is week — for tooltips */
  weekStart?: string;
  collected: number;
  payouts: number;
  bills: number;
  net: number;
}

/** Weekly cash position: money in (invoices paid) vs obligations (partner + bills to pay). */
export interface WeeklyCashPositionRow {
  label: string;
  weekStart?: string;
  /** Invoices marked paid in this week */
  collected: number;
  /** Self-bills awaiting / ready to pay (bucketed by work week) */
  partnerToPay: number;
  /** Company bills not yet paid (bucketed by due date week) */
  billsToPay: number;
  /** collected − partnerToPay − billsToPay */
  net: number;
}

export type CashflowGranularity = "week" | "month";

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Week starts Monday (local). */
export function startOfWeekMondayFromYmd(ymd: string): string {
  const d = parseYmd(ymd);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toYmd(d);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = parseYmd(ymd);
  d.setDate(d.getDate() + days);
  return toYmd(d);
}

/** e.g. "5 Jan – 11 Jan ’26" with optional year on end week */
export function weekRangeLabel(weekStartYmd: string, includeYear = true): string {
  const s = parseYmd(weekStartYmd);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  const o: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const sy = s.getFullYear();
  const ey = e.getFullYear();
  if (includeYear && sy !== ey) {
    return `${s.toLocaleDateString(undefined, { ...o, year: "2-digit" })} – ${e.toLocaleDateString(undefined, { ...o, year: "2-digit" })}`;
  }
  if (includeYear) {
    return `${s.toLocaleDateString(undefined, o)} – ${e.toLocaleDateString(undefined, { ...o, year: "2-digit" })}`;
  }
  return `${s.toLocaleDateString(undefined, o)} – ${e.toLocaleDateString(undefined, o)}`;
}

export function buildCashflowBuckets(
  granularity: CashflowGranularity,
  fromIso: string,
  toIso: string,
  invPaid: { paid_date?: string; amount?: number }[] | null,
  sbPaid: { updated_at?: string; net_payout?: number }[] | null,
  billsPaid: { amount: number; paid_at?: string }[],
): CashflowBucketRow[] {
  const fromDay = fromIso.slice(0, 10);
  const toDay = toIso.slice(0, 10);
  const endD = parseYmd(toDay);

  if (granularity === "month") {
    const monthKeys: string[] = [];
    const buckets: CashflowBucketRow[] = [];
    const curM = new Date(new Date(fromIso).getFullYear(), new Date(fromIso).getMonth(), 1);
    const endM = new Date(toIso);
    while (curM <= endM) {
      monthKeys.push(`${curM.getFullYear()}-${String(curM.getMonth() + 1).padStart(2, "0")}`);
      buckets.push({
        label: curM.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
        collected: 0,
        payouts: 0,
        bills: 0,
        net: 0,
      });
      curM.setMonth(curM.getMonth() + 1);
      if (monthKeys.length > 36) break;
    }
    const keyToIdxM = new Map(monthKeys.map((k, i) => [k, i]));
    for (const inv of invPaid ?? []) {
      const pd = inv.paid_date;
      const mk = pd?.slice(0, 7);
      const i = mk ? keyToIdxM.get(mk) : undefined;
      if (i !== undefined) buckets[i]!.collected += Number(inv.amount ?? 0);
    }
    for (const sb of sbPaid ?? []) {
      const u = sb.updated_at;
      if (!u) continue;
      const idx = keyToIdxM.get(u.slice(0, 7));
      if (idx !== undefined) buckets[idx]!.payouts += Number(sb.net_payout ?? 0);
    }
    for (const bill of billsPaid) {
      const u = bill.paid_at;
      if (!u) continue;
      const idx = keyToIdxM.get(u.slice(0, 7));
      if (idx !== undefined) buckets[idx]!.bills += Number(bill.amount ?? 0);
    }
    for (const b of buckets) {
      b.net = b.collected - b.payouts - b.bills;
    }
    return buckets;
  }

  const weekStarts: string[] = [];
  let w = startOfWeekMondayFromYmd(fromDay);
  while (parseYmd(w) <= endD && weekStarts.length < 120) {
    weekStarts.push(w);
    w = addDaysYmd(w, 7);
  }
  const keyToIdxW = new Map(weekStarts.map((k, i) => [k, i]));
  const buckets: CashflowBucketRow[] = weekStarts.map((k) => ({
    label: weekRangeLabel(k, true),
    weekStart: k,
    collected: 0,
    payouts: 0,
    bills: 0,
    net: 0,
  }));

  for (const inv of invPaid ?? []) {
    const d = inv.paid_date?.slice(0, 10);
    if (!d) continue;
    const ws = startOfWeekMondayFromYmd(d);
    const i = keyToIdxW.get(ws);
    if (i !== undefined) buckets[i]!.collected += Number(inv.amount ?? 0);
  }
  for (const sb of sbPaid ?? []) {
    const u = sb.updated_at;
    if (!u) continue;
    const d = u.slice(0, 10);
    const ws = startOfWeekMondayFromYmd(d);
    const i = keyToIdxW.get(ws);
    if (i !== undefined) buckets[i]!.payouts += Number(sb.net_payout ?? 0);
  }
  for (const bill of billsPaid) {
    const u = bill.paid_at;
    if (!u) continue;
    const d = u.slice(0, 10);
    const ws = startOfWeekMondayFromYmd(d);
    const i = keyToIdxW.get(ws);
    if (i !== undefined) buckets[i]!.bills += Number(bill.amount ?? 0);
  }
  for (const b of buckets) {
    b.net = b.collected - b.payouts - b.bills;
  }
  return buckets;
}

/** Week-start Mondays from `fromDay` through `toDay` (YYYY-MM-DD), inclusive window. */
export function listWeekStartsBetween(fromDay: string, toDay: string, maxWeeks = 120): string[] {
  const endD = parseYmd(toDay);
  const weekStarts: string[] = [];
  let w = startOfWeekMondayFromYmd(fromDay);
  while (parseYmd(w) <= endD && weekStarts.length < maxWeeks) {
    weekStarts.push(w);
    w = addDaysYmd(w, 7);
  }
  return weekStarts;
}

export function buildWeeklyJobSoldSeries<T>(
  jobs: T[],
  getRevenue: (j: T) => number,
  fromIso: string,
  toIso: string,
  /** Defaults to job `created_at` date (legacy “sold” week). */
  getBucketYmd?: (j: T) => string | null | undefined,
): { label: string; sold: number }[] {
  const fromDay = fromIso.slice(0, 10);
  const toDay = toIso.slice(0, 10);
  const weekStarts = listWeekStartsBetween(fromDay, toDay);
  const keyToIdx = new Map(weekStarts.map((k, i) => [k, i]));
  const buckets = weekStarts.map((k) => ({
    label: weekRangeLabel(k, true),
    sold: 0,
  }));
  for (const j of jobs) {
    const raw =
      getBucketYmd?.(j) ??
      (j as { created_at?: string }).created_at?.slice(0, 10);
    if (!raw) continue;
    const ws = startOfWeekMondayFromYmd(raw.slice(0, 10));
    const i = keyToIdx.get(ws);
    if (i !== undefined) buckets[i]!.sold += getRevenue(j);
  }
  return buckets;
}

/** Prefer weekly bars for ranges up to ~6 months; longer ranges use months to keep charts readable. */
export function pickCashflowGranularity(bounds: { fromIso: string; toIso: string } | null): CashflowGranularity {
  if (!bounds) return "month";
  const a = new Date(`${bounds.fromIso.slice(0, 10)}T12:00:00`).getTime();
  const b = new Date(`${bounds.toIso.slice(0, 10)}T12:00:00`).getTime();
  const days = Math.max(1, Math.round((b - a) / 86400000) + 1);
  return days <= 190 ? "week" : "month";
}

/**
 * Cash position by calendar week: **customer cash in** from `job_payments` (deposit + final by `payment_date`)
 * vs partner self-bills **to pay** vs company bills **to pay** (due week).
 */
export function buildWeeklyCashPositionBuckets(
  fromIso: string,
  toIso: string,
  customerCashIn: { payment_date?: string; amount?: number }[] | null,
  selfBillsOutstanding: { net_payout?: number; week_start?: string | null; created_at?: string }[] | null,
  billsOutstanding: { amount?: number; due_date?: string }[] | null
): WeeklyCashPositionRow[] {
  const fromDay = fromIso.slice(0, 10);
  const toDay = toIso.slice(0, 10);
  const endD = parseYmd(toDay);

  const weekStarts: string[] = [];
  let w = startOfWeekMondayFromYmd(fromDay);
  while (parseYmd(w) <= endD && weekStarts.length < 120) {
    weekStarts.push(w);
    w = addDaysYmd(w, 7);
  }
  const keyToIdxW = new Map(weekStarts.map((k, i) => [k, i]));
  const buckets: WeeklyCashPositionRow[] = weekStarts.map((k) => ({
    label: weekRangeLabel(k, true),
    weekStart: k,
    collected: 0,
    partnerToPay: 0,
    billsToPay: 0,
    net: 0,
  }));

  for (const row of customerCashIn ?? []) {
    const d = row.payment_date?.slice(0, 10);
    if (!d) continue;
    const ws = startOfWeekMondayFromYmd(d);
    const idx = keyToIdxW.get(ws);
    if (idx !== undefined) buckets[idx]!.collected += Number(row.amount ?? 0);
  }

  for (const sb of selfBillsOutstanding ?? []) {
    const raw = sb.week_start?.slice(0, 10) ?? sb.created_at?.slice(0, 10);
    if (!raw) continue;
    const ws = startOfWeekMondayFromYmd(raw);
    const i = keyToIdxW.get(ws);
    if (i !== undefined) buckets[i]!.partnerToPay += Number(sb.net_payout ?? 0);
  }

  for (const bill of billsOutstanding ?? []) {
    const dd = bill.due_date?.slice(0, 10);
    if (!dd) continue;
    const ws = startOfWeekMondayFromYmd(dd);
    const i = keyToIdxW.get(ws);
    if (i !== undefined) buckets[i]!.billsToPay += Number(bill.amount ?? 0);
  }

  for (const b of buckets) {
    b.net = b.collected - b.partnerToPay - b.billsToPay;
  }
  return buckets;
}
