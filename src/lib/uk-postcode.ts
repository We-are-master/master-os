/**
 * Detect and normalise UK postcodes inside free-text addresses (e.g. Mapbox place_name).
 * Inward code is always 3 chars (digit + 2 letters); outward is the rest.
 */
const UK_POSTCODE_IN_TEXT =
  /\b((GIR\s*0AA)|([A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]?\s*\d[ABD-HJLNP-UW-Z]{2}))\b/i;

export function normalizeUkPostcode(raw: string): string {
  const compact = raw.replace(/\s+/g, "").toUpperCase();
  if (compact === "GIR0AA") return "GIR 0AA";
  if (compact.length < 5) return raw.trim().toUpperCase();
  const inward = compact.slice(-3);
  const outward = compact.slice(0, -3);
  return `${outward} ${inward}`;
}

/** First valid UK postcode found in `text`, or null. */
export function extractUkPostcode(text: string): string | null {
  const m = text.match(UK_POSTCODE_IN_TEXT);
  if (!m) return null;
  return normalizeUkPostcode(m[0]);
}

/**
 * Postcode for partner match / geocoding: explicit `postcode` field wins,
 * otherwise parse from free-text property_address.
 */
export function resolvePropertyPostcode(
  explicitPostcode: string | null | undefined,
  propertyAddress: string,
): string | null {
  const raw = String(explicitPostcode ?? "").trim();
  if (raw) {
    const fromField = extractUkPostcode(raw);
    if (fromField) return fromField;
  }
  return extractUkPostcode(propertyAddress);
}

/** Append postcode to address when sent separately (storage + geocoding). */
export function propertyAddressWithPostcode(
  propertyAddress: string,
  postcode: string | null,
): string {
  const trimmed = propertyAddress.trim();
  if (!postcode || extractUkPostcode(trimmed)) return trimmed;
  return `${trimmed}, ${postcode}`;
}
