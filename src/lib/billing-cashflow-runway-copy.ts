import { formatCurrency } from "@/lib/utils";
import type { RunwayViewMode } from "@/lib/billing-runway-views";

/** In-product copy explaining Cash-Flow Runway buckets. */

const PL_HINT = [
  "Projection by week (Mon–Sun), not payments already made.",
  "Top line (P&L): receivables due minus payouts and expenses due that week — not realized cash.",
  "Green (up): open invoice balances whose due date falls in that week (excludes draft, on hold, paid).",
  "Coral (down): self-bills due that week (approved, ready, draft/accumulating) + open expenses (bills) due that week.",
  "Click any week column to open a line-item breakdown.",
  "Use ← → to shift the 10-week window when no period filter is active.",
].join(" ");

const ACCRUAL_HINT = [
  "Forward projection by week (Mon–Sun) — full pipeline scenario with running cash balance.",
  "Top line (Em caixa): opening cash + pipeline revenue − all costs due, carried week to week.",
  "Green (up): draft + open invoices + scheduled jobs without invoice yet (by expected due date from account terms).",
  "Coral (down): all self-bills due (approved, ready, draft) + open bills + pending payroll.",
  "Click a week for Revenue / Partners / Admin breakdown. Edit opening cash per week in the modal.",
  "Default opening balance: Settings → Setup → Finance. Window: 10 weeks when no period filter.",
].join(" ");

const CASH_HINT = [
  "Cash runway by week (Mon–Sun) — money actually in and out, plus your bank balance carry-forward.",
  "Green (up): customer payments from job_payments by payment date (deposit + final).",
  "Coral (down): past weeks show paid self-bills and expenses; current and future weeks show projected dues.",
  "Top line (Em caixa): opening cash + in − out. Set opening cash per week in the week breakdown modal.",
  "Default opening balance comes from Settings → Setup → Finance. Click a week for details.",
].join(" ");

export const CASHFLOW_RUNWAY_HINT = PL_HINT;

export function cashflowRunwayHintForView(view: RunwayViewMode): string {
  if (view === "accrual") return ACCRUAL_HINT;
  if (view === "cash") return CASH_HINT;
  return PL_HINT;
}

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

export function formatCashRunwayClosing(closing: number | undefined): string {
  if (closing === undefined) return "·";
  return formatCurrency(closing);
}

export function cashflowWeekColumnTitle(
  view: RunwayViewMode,
  weekTitle: string,
  moneyIn: number,
  moneyOut: number,
  closingBalance?: number,
): string {
  const parts = [weekTitle];
  if ((view === "cash" || view === "accrual") && closingBalance !== undefined) {
    parts.push(`Em caixa: ${formatCurrency(closingBalance)}`);
  } else if (cashflowWeekHasActivity(moneyIn, moneyOut)) {
    parts.push(`P&L: ${formatCashflowWeekPnl(moneyIn, moneyOut)}`);
  }
  if (moneyIn > 0) {
    parts.push(
      view === "accrual"
        ? "In: pipeline revenue"
        : view === "cash"
          ? "In: customer payments"
          : "In: open receivables due this week",
    );
  }
  if (moneyOut > 0) {
    parts.push(
      view === "accrual"
        ? "Out: partners + bills + payroll"
        : view === "cash"
          ? "Out: paid or projected payouts"
          : "Out: self-bills + expenses due this week",
    );
  }
  return parts.join(" · ");
}
