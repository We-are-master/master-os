/** Customer billing document prefix (statement / receipt — not a VAT invoice). */
export const BILLING_REFERENCE_PREFIX = "RCP";

const LEGACY_PREFIX_RE = /^(INV|RCP|RC)-/i;

/** Strip legacy prefixes, keeping year-sequence (e.g. 2026-357). */
export function billingReferenceShort(reference: string): string {
  const trimmed = (reference ?? "").trim();
  if (!trimmed) return "";
  return trimmed.replace(LEGACY_PREFIX_RE, "").trim() || trimmed;
}

/** Display ref as RCP-YYYY-NNN (maps legacy INV-/RC- rows for UI/PDF/email). */
export function displayBillingReference(reference: string): string {
  const short = billingReferenceShort(reference);
  if (!short) return `${BILLING_REFERENCE_PREFIX}-`;
  return `${BILLING_REFERENCE_PREFIX}-${short}`;
}
