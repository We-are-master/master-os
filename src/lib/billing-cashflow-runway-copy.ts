import { formatCurrency } from "@/lib/utils";

/** In-product copy explaining Cash-Flow Runway buckets (projection by due date, not realized cash). */

export const CASHFLOW_RUNWAY_HINT = [
  "Projection by week (Mon–Sun), not payments already made.",
  "Top line (P&L): receivables due minus payouts and expenses due that week — not realized cash.",
  "Green (up): open invoice balances whose due date falls in that week (excludes draft, on hold, paid).",
  "Coral (down): self-bills due that week (approved, ready, draft/accumulating) + open expenses (bills) due that week. KPI Money Out still counts approved only.",
  "Click any week column to open a line-item breakdown (what is due in vs out).",
  "Use ← → to shift the 8-week window when no period filter is active.",
].join(" ");

export function cashflowWeekNet(moneyIn: number, moneyOut: number): number {
  return Math.round((moneyIn - moneyOut) * 100) / 100;
}

export function cashflowWeekHasActivity(moneyIn: number, moneyOut: number): boolean {
  return moneyIn > 0.02 || moneyOut > 0.02;
}

export function formatCashflowWeekPnl(moneyIn: number, moneyOut: number): string {
  if (!cashflowWeekHasActivity(moneyIn, moneyOut)) return "·";
  const net = cashflowWeekNet(moneyIn, moneyOut);
  return `${net >= 0 ? "+" : ""}${formatCurrency(net)}`;
}

export function cashflowWeekColumnTitle(weekTitle: string, moneyIn: number, moneyOut: number): string {
  const parts = [weekTitle];
  if (cashflowWeekHasActivity(moneyIn, moneyOut)) {
    parts.push(`P&L: ${formatCashflowWeekPnl(moneyIn, moneyOut)}`);
  }
  if (moneyIn > 0) parts.push(`In: open receivables due this week`);
  if (moneyOut > 0) parts.push(`Out: self-bills (approved/ready/draft) + expenses due this week`);
  return parts.join(" · ");
}
