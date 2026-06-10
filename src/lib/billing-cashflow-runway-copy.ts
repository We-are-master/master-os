/** In-product copy explaining Cash-Flow Runway buckets (projection by due date, not realized cash). */

export const CASHFLOW_RUNWAY_HINT = [
  "Projection by week (Mon–Sun), not payments already made.",
  "Green (up): open invoice balances whose due date falls in that week (excludes draft, on hold, paid).",
  "Coral (down): approved self-bills due that week + open expenses (bills) due that week.",
  "Click any week column to open a line-item breakdown (what is due in vs out).",
  "Use ← → to shift the 8-week window when no period filter is active.",
].join(" ");

export function cashflowWeekColumnTitle(weekTitle: string, moneyIn: number, moneyOut: number): string {
  const parts = [weekTitle];
  if (moneyIn > 0) parts.push(`In: open receivables due this week`);
  if (moneyOut > 0) parts.push(`Out: approved self-bills + open expenses due this week`);
  return parts.join(" · ");
}
