import { extractUkPostcode } from "@/lib/uk-postcode";

/**
 * Pragmatic central-London CCZ heuristic by postcode outward district.
 * Keeps UX automatic while still editable by the operator.
 */
const CCZ_PREFIXES = ["EC1", "EC2", "EC3", "EC4", "WC1", "WC2", "SW1", "SE1", "W1"];

export function isLikelyCczAddress(address?: string | null): boolean {
  const pc = extractUkPostcode(address ?? "");
  if (!pc) return false;
  const compact = pc.replace(/\s+/g, "").toUpperCase();
  return CCZ_PREFIXES.some((p) => compact.startsWith(p));
}

export function computeAccessSurcharge(params: { inCcz?: boolean | null; hasFreeParking?: boolean | null }): number {
  const ccz = params.inCcz === true ? 15 : 0;
  const parking = params.hasFreeParking === false ? 15 : 0;
  return ccz + parking;
}

