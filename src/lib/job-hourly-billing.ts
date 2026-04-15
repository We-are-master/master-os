import type { Job } from "@/types/database";

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

