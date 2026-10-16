import { sanitizePostgrestValue } from "@/lib/supabase/sanitize";

/**
 * Columns the Directory search box matches with a plain ILIKE.
 * `location` is the legacy free-text field older rows still use instead of
 * `partner_address`, and UTR/CRN are here so finance can find a partner by the
 * number printed on a self-bill.
 */
const PARTNER_SEARCH_TEXT_COLUMNS = [
  "company_name",
  "contact_name",
  "email",
  "partner_address",
  "location",
  "utr",
  "crn",
] as const;

/**
 * Loose ILIKE pattern for a phone number.
 *
 * The same UK number lives in the table in three shapes: `07984493483`,
 * `07984 493483` and `+44 7984 493483`. An ILIKE on what the user typed finds
 * one of the three and misses the others. So we keep only the digits, drop the
 * trunk `0` / country `44` prefix, and put `%` between the remaining digits:
 * the pattern then survives any spacing and either prefix.
 *
 * Returns null for anything under 4 digits, where the pattern would match
 * half the table.
 */
export function partnerPhoneSearchPattern(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return null;
  const withoutPrefix = digits.replace(/^(?:0044|44|0)/, "");
  const needle = withoutPrefix.length >= 4 ? withoutPrefix : digits;
  return `%${needle.split("").join("%")}%`;
}

/**
 * PostgREST `or(...)` expression for the Directory search box: name, email,
 * phone, address and tax numbers in one pass.
 *
 * The caller must not sanitise the input first — this does it, and the `%`
 * separators of the phone pattern are built here, after the metacharacters
 * are gone.
 */
export function buildPartnerSearchOrFilter(raw: string | null | undefined): string | null {
  const safe = sanitizePostgrestValue(raw);
  if (!safe) return null;

  const clauses = PARTNER_SEARCH_TEXT_COLUMNS.map((column) => `${column}.ilike.%${safe}%`);
  const phonePattern = partnerPhoneSearchPattern(safe);
  if (phonePattern) clauses.push(`phone.ilike.${phonePattern}`);

  return clauses.join(",");
}
