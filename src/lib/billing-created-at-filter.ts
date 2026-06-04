/**
 * Billing (Invoices + Self-billing): filter rows by document `created_at` only.
 * UI exposes All + custom date range (same pill pattern as ops screens, without schedule presets).
 */

export type BillingCreatedAtFilterValue = {
  mode: "all" | "custom";
  /** YYYY-MM-DD — used when `mode === "custom"`. */
  customFrom?: string;
  customTo?: string;
};

export const DEFAULT_BILLING_CREATED_AT_FILTER: BillingCreatedAtFilterValue = {
  mode: "all",
  customFrom: "",
  customTo: "",
};

/** Inclusive local calendar bounds for querying `created_at`. */
export function resolveBillingCreatedAtYmdBounds(
  value: BillingCreatedAtFilterValue,
): { from: string; to: string } | null {
  if (value.mode === "all") return null;
  const a = value.customFrom?.trim() ?? "";
  const b = value.customTo?.trim() ?? "";
  if (!a || !b) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export function billingCreatedAtFilterDescription(value: BillingCreatedAtFilterValue): string {
  if (value.mode === "all") return "All · created date";
  const bounds = resolveBillingCreatedAtYmdBounds(value);
  if (!bounds) return "Pick from / to";
  const span =
    bounds.from === bounds.to ? bounds.from : `${bounds.from} – ${bounds.to}`;
  return `Created ${span}`;
}

export function billingCreatedAtFilterIsActive(value: BillingCreatedAtFilterValue): boolean {
  return value.mode === "custom" && resolveBillingCreatedAtYmdBounds(value) != null;
}
