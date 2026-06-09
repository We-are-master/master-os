import { addDaysYmd, todayYmdLocal, type YmdBounds } from "@/lib/billing-standalone-period";

/** Billing control tower: All or custom calendar range for due / pay-period views. */
export type BillingStandaloneFilterValue = {
  mode: "all" | "custom";
  customFrom?: string;
  customTo?: string;
};

export const DEFAULT_BILLING_STANDALONE_FILTER: BillingStandaloneFilterValue = {
  mode: "all",
  customFrom: "",
  customTo: "",
};

/** Last 90 calendar days (inclusive) — initial Supabase fetch window (not the UI default). */
export function defaultBillingStandaloneFilter(): BillingStandaloneFilterValue {
  const to = todayYmdLocal();
  const from = addDaysYmd(to, -89);
  return { mode: "custom", customFrom: from, customTo: to };
}

/** Fixed bounds for the first billing data load (open items + last 90 days). */
export function getBillingInitialFetchBounds(): YmdBounds {
  const { customFrom, customTo } = defaultBillingStandaloneFilter();
  return { from: customFrom!, to: customTo! };
}

export function resolveBillingStandaloneFilterBounds(
  value: BillingStandaloneFilterValue,
): YmdBounds | null {
  if (value.mode === "all") return null;
  const a = value.customFrom?.trim() ?? "";
  const b = value.customTo?.trim() ?? "";
  if (!a || !b) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export function billingStandaloneFilterDescription(value: BillingStandaloneFilterValue): string {
  if (value.mode === "all") return "All";
  const bounds = resolveBillingStandaloneFilterBounds(value);
  if (!bounds) return "Pick from / to";
  return bounds.from === bounds.to ? bounds.from : `${bounds.from} – ${bounds.to}`;
}

export function billingStandaloneFilterIsActive(value: BillingStandaloneFilterValue): boolean {
  return value.mode === "custom" && resolveBillingStandaloneFilterBounds(value) != null;
}
