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
  /** Prefer implied £/h from stored totals when hours are known — beats stale `hourly_*_rate` after approve. */
  const impliedClient =
    rawBilled > 0 ? Math.round(((Number(job.client_price) || 0) / rawBilled) * 100) / 100 : 0;
  const impliedPartner =
    rawBilled > 0 ? Math.round(((Number(job.partner_cost) || 0) / rawBilled) * 100) / 100 : 0;
  const clientRate =
    impliedClient > 0.02
      ? impliedClient
      : Number(job.hourly_client_rate) > 0
        ? Number(job.hourly_client_rate)
        : Math.round(((Number(job.client_price) || 0) / billedHours) * 100) / 100;
  const partnerRate =
    impliedPartner > 0.02
      ? impliedPartner
      : Number(job.hourly_partner_rate) > 0
        ? Number(job.hourly_partner_rate)
        : Math.round(((Number(job.partner_cost) || 0) / billedHours) * 100) / 100;
  return {
    clientRate: Math.max(0, clientRate || 0),
    partnerRate: Math.max(0, partnerRate || 0),
  };
}

