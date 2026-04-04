import { extractUkPostcode } from "@/lib/uk-postcode";

/**
 * London **Congestion Charge** area — heuristic from the property postcode only.
 * We use outward districts that fall in the TfL CCZ / central Zone 1 core (not all of fare Zone 1).
 * If there is no UK postcode in the address string, CCZ cannot apply.
 * Outside this set, `in_ccz` must not charge and the UI keeps the control off / disabled.
 * Inside the set, the product still requires an explicit “Apply CCZ” choice — do not auto-enable the flag.
 */
const CCZ_CONGESTION_ZONE1_OUTWARD_PREFIXES = ["EC1", "EC2", "EC3", "EC4", "WC1", "WC2", "SW1", "SE1", "W1"];

/** True when `address` contains a UK postcode in the central London CCZ list above. */
export function isLikelyCczAddress(address?: string | null): boolean {
  const pc = extractUkPostcode(address ?? "");
  if (!pc) return false;
  const compact = pc.replace(/\s+/g, "").toUpperCase();
  return CCZ_CONGESTION_ZONE1_OUTWARD_PREFIXES.some((p) => compact.startsWith(p));
}

/**
 * Whether the CCZ surcharge should apply: user flag is on **and** the saved address is in the CCZ postcode list.
 * Use this for pricing/display so a stale `in_ccz` row cannot charge jobs outside central London.
 */
export function effectiveInCczForAddress(wantsCcz: boolean | null | undefined, propertyAddress?: string | null): boolean {
  return Boolean(wantsCcz) && isLikelyCczAddress(propertyAddress);
}

/** Per-line customer access fees (Congestion Charge + paid parking on site). */
export const ACCESS_CCZ_FEE_GBP = 15;
export const ACCESS_PARKING_FEE_GBP = 15;

export function computeAccessSurcharge(params: { inCcz?: boolean | null; hasFreeParking?: boolean | null }): number {
  const ccz = params.inCcz === true ? ACCESS_CCZ_FEE_GBP : 0;
  const parking = params.hasFreeParking === false ? ACCESS_PARKING_FEE_GBP : 0;
  return ccz + parking;
}

