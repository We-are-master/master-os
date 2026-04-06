/** Deposit is configured as % of customer sell; `quotes.deposit_required` stores the computed £ amount. */

export function clampDepositPercent(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, n));
}

/** Rounded to 2 decimal places (pence). */
export function depositAmountFromPercent(lineTotal: number, percent: number): number {
  const p = clampDepositPercent(percent);
  return Math.round(Math.max(0, lineTotal) * (p / 100) * 100) / 100;
}

/** Infer % from legacy stored £ deposit and total (e.g. quotes before deposit_percent existed). */
export function inferDepositPercentFromLegacy(depositRequired: number, totalValue: number): number {
  if (totalValue > 0.01 && depositRequired >= 0) {
    return clampDepositPercent(Math.round((depositRequired / totalValue) * 1000) / 10);
  }
  return 50;
}
