/**
 * Shared UI copy for job billing ({@link Job["job_type"]}) and catalog `pricing_mode` rows.
 */
export const PRICING_MODE_LABELS = {
  fixed: "Fixed - Custom Pricing",
  hourly: "Hourly - Smart Pricing",
} as const;

export function pricingModeLabel(mode: "fixed" | "hourly"): string {
  return PRICING_MODE_LABELS[mode];
}
