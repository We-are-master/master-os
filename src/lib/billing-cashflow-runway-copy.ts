import { formatCurrency } from "@/lib/utils";
import type { RunwayViewMode } from "@/lib/billing-runway-views";

/** In-product copy explaining Cash-Flow Runway buckets. */

const PL_HINT = [
  "Open receivables minus self-bills and expenses due in each period. This is a forecast, not realised profit.",
  "Receivables exclude draft, on-hold and paid invoices. Outgoings include open expenses and self-bills, including drafts.",
  "Select a period to review its line items.",
].join(" ");

const ACCRUAL_HINT = [
  "Project the running balance using pipeline revenue and costs due in each period.",
  "Includes draft and open invoices, scheduled jobs without invoices, self-bills, open expenses and pending payroll.",
  "The closing balance carries forward. Select a period to review items or set its opening balance.",
].join(" ");

const CASH_HINT = [
  "Customer receipts are grouped by payment date. Past outgoings use paid self-bills and expenses; current and future outgoings include projected amounts.",
  "Closing balance is the opening balance plus receipts minus outgoings. Select a period to review items or set its opening balance.",
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
    parts.push(`Closing balance: ${formatCurrency(closingBalance)}`);
  } else if (cashflowWeekHasActivity(moneyIn, moneyOut)) {
    parts.push(`Due-date forecast: ${formatCashflowWeekPnl(moneyIn, moneyOut)}`);
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
