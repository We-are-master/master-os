import type { Job } from "@/types/database";
import { computeAccessSurcharge, effectiveInCczForAddress } from "@/lib/ccz";

type JobAccessFinancialSlice = Pick<
  Job,
  "in_ccz" | "has_free_parking" | "property_address" | "extras_amount" | "client_price" | "customer_deposit"
>;

/**
 * Access fees (CCZ + parking) folded into `extras_amount` and `customer_final_payment`.
 * Use when toggling CCZ/parking or when the property address changes effective CCZ eligibility.
 */
export function patchJobFinancialsForAccessTransition(
  job: JobAccessFinancialSlice,
  next: Partial<Pick<Job, "in_ccz" | "has_free_parking" | "property_address">>,
): { extras_amount: number; customer_final_payment: number } {
  const oldEffCcz = effectiveInCczForAddress(job.in_ccz, job.property_address);
  const oldSur = computeAccessSurcharge({ inCcz: oldEffCcz, hasFreeParking: job.has_free_parking });

  const nextInCcz = next.in_ccz !== undefined ? next.in_ccz : job.in_ccz;
  const nextAddr = next.property_address !== undefined ? next.property_address : job.property_address;
  const nextParking = next.has_free_parking !== undefined ? next.has_free_parking : job.has_free_parking;
  const nextEffCcz = effectiveInCczForAddress(nextInCcz, nextAddr);
  const newSur = computeAccessSurcharge({ inCcz: nextEffCcz, hasFreeParking: nextParking });

  const delta = Math.round((newSur - oldSur) * 100) / 100;
  const extras = Math.max(0, Math.round((Number(job.extras_amount ?? 0) + delta) * 100) / 100);
  const deposit = Number(job.customer_deposit ?? 0);
  const clientPrice = Number(job.client_price ?? 0);
  const customer_final_payment = Math.round(Math.max(0, clientPrice + extras - deposit) * 100) / 100;
  return { extras_amount: extras, customer_final_payment };
}
