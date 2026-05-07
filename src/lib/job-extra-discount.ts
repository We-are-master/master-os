import type { CustomerExtraAllocation, PartnerExtraAllocation } from "@/lib/job-extra-charges";

export function isJobExtraDiscountExtraType(extraType: string | null | undefined): boolean {
  return (extraType ?? "").trim().toUpperCase().startsWith("DISCOUNT");
}

/**
 * Where a client extra row hits the job row: charges keep Labour/CCZ/Parking in `extras_amount`
 * (legacy behaviour); discounts can target labour, extras bucket, or materials.
 */
export function customerExtraLedgerAllocation(extraType: string): CustomerExtraAllocation {
  const u = extraType.trim().toUpperCase();
  if (u.includes("MATERIAL")) return "materials";
  const discount = isJobExtraDiscountExtraType(extraType);
  if (discount && (u.includes("LABOUR") || u.includes("LABOR"))) return "labour";
  return "extras";
}

/** Partner discount: claw back from labour line vs materials. */
export function partnerDiscountAllocationFromExtraType(extraType: string): PartnerExtraAllocation {
  const u = extraType.trim().toUpperCase();
  if (u.includes("MATERIAL")) return "materials";
  return "partner_cost";
}

/** Entries store amount > 0; discounts apply as negative deltas in rollups / tooltips. */
export function signedLedgerDisplayAmount(extraType: string, amountPositive: number): number {
  const a = Math.abs(Number(amountPositive) || 0);
  return isJobExtraDiscountExtraType(extraType) ? -a : a;
}
