import type { CatalogPricingMode, Job } from "@/types/database";

/** Default minimum billed hours for new hourly jobs (internal UI + API). */
export const DEFAULT_HOURLY_BILLED_HOURS = 2;

/**
 * Initial billed hours for a new hourly job.
 * Explicit override (including values below 2) wins; otherwise max(2, catalog default).
 */
export function resolveInitialBilledHours(
  catalogDefaultHours?: number | null,
  explicitOverride?: number | null | string,
): number {
  const overrideRaw = explicitOverride;
  const overrideNum =
    overrideRaw != null && overrideRaw !== "" ? Number(overrideRaw) : NaN;
  if (Number.isFinite(overrideNum) && overrideNum > 0) {
    return Math.max(0.25, overrideNum);
  }
  const fromCatalog = Number(catalogDefaultHours);
  const catalogHours =
    Number.isFinite(fromCatalog) && fromCatalog > 0
      ? fromCatalog
      : DEFAULT_HOURLY_BILLED_HOURS;
  return Math.max(DEFAULT_HOURLY_BILLED_HOURS, catalogHours);
}

/** Persist catalog partner_cost bundle from UI hourly rate × default hours. */
export function catalogPartnerBundleFromHourlyRate(
  partnerHourlyRate: number,
  defaultHours: number,
): number {
  const hours = Math.max(0.25, Number(defaultHours) || DEFAULT_HOURLY_BILLED_HOURS);
  return Math.round(Math.max(0, partnerHourlyRate) * hours * 100) / 100;
}

/** Margin preview: fixed = flat partner cost; hourly = partner £/h × default hours. */
export function catalogPartnerTotalForDisplay(opts: {
  pricingMode: CatalogPricingMode;
  partnerFieldValue: number;
  defaultHours?: number;
}): number {
  const val = Math.max(0, Number(opts.partnerFieldValue) || 0);
  if (opts.pricingMode !== "hourly") return val;
  const hours = Math.max(0.25, Number(opts.defaultHours) || DEFAULT_HOURLY_BILLED_HOURS);
  return Math.round(val * hours * 100) / 100;
}

/** Minimum 1h, then round up in 30-minute blocks. */
export function billedHoursFromElapsedSeconds(elapsedSeconds: number): number {
  const secs = Math.max(0, Number(elapsedSeconds) || 0);
  if (secs <= 0) return 1;
  if (secs <= 3600) return 1;
  const halfHours = Math.ceil(secs / 1800);
  return halfHours / 2;
}

export function computeHourlyTotals(params: {
  elapsedSeconds: number;
  clientHourlyRate: number;
  partnerHourlyRate: number;
}) {
  const billedHours = billedHoursFromElapsedSeconds(params.elapsedSeconds);
  const clientTotal = Math.round((Math.max(0, params.clientHourlyRate) * billedHours) * 100) / 100;
  const partnerTotal = Math.round((Math.max(0, params.partnerHourlyRate) * billedHours) * 100) / 100;
  return { billedHours, clientTotal, partnerTotal };
}

export function partnerHourlyRateFromCatalogBundle(
  partnerBundleCost: number | null | undefined,
  defaultHours: number | null | undefined,
): number {
  const bundle = Math.max(0, Number(partnerBundleCost) || 0);
  const hours = Math.max(0.25, Number(defaultHours) || 1);
  if (bundle <= 0 || hours <= 0) return 0;
  return Math.round((bundle / hours) * 100) / 100;
}

export function resolveJobHourlyRates(job: Job): { clientRate: number; partnerRate: number } {
  const rawBilled = Number(job.billed_hours);
  const billedHours = Math.max(0.25, rawBilled > 0 ? rawBilled : 1);
  /**
   * Keep hourly labour rates isolated from one-time charges:
   * - client labour base = client_price - extras_amount (CCZ/parking/manual extras stay flat)
   * - partner labour base = partner_cost - partner_extras_amount (extra payout stays flat)
   */
  const clientPriceStored = Math.max(0, Number(job.client_price) || 0);
  const clientFlatExtrasStored = Math.max(0, Number(job.extras_amount) || 0);
  const clientLabourBase = Math.max(0, clientPriceStored - clientFlatExtrasStored);
  const partnerCostStored = Math.max(0, Number(job.partner_cost) || 0);
  const partnerFlatExtrasStored = Math.max(0, Number(job.partner_extras_amount) || 0);
  const partnerLabourBase = Math.max(0, partnerCostStored - partnerFlatExtrasStored);
  const impliedClient =
    rawBilled > 0 ? Math.round((clientLabourBase / rawBilled) * 100) / 100 : 0;
  const impliedPartner =
    rawBilled > 0 ? Math.round((partnerLabourBase / rawBilled) * 100) / 100 : 0;
  const clientRate =
    Number(job.hourly_client_rate) > 0
      ? Number(job.hourly_client_rate)
      : impliedClient > 0.02
        ? impliedClient
        : Math.round((clientLabourBase / billedHours) * 100) / 100;
  const partnerRate =
    Number(job.hourly_partner_rate) > 0
      ? Number(job.hourly_partner_rate)
      : impliedPartner > 0.02
        ? impliedPartner
        : Math.round((partnerLabourBase / billedHours) * 100) / 100;
  return {
    clientRate: Math.max(0, clientRate || 0),
    partnerRate: Math.max(0, partnerRate || 0),
  };
}

