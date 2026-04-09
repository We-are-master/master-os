/**
 * PostgREST filter sanitiser.
 *
 * PostgREST does NOT have SQL injection — query parameters reach Postgres
 * via prepared statements safely. But the *filter expression strings* used
 * by `.or(...)` and `.filter(...)` are parsed by PostgREST itself, so a
 * value containing `,`, `(`, `)`, `:`, `*` or `\` can break out of the
 * intended filter and inject additional clauses.
 *
 * Example attack against `.or(\`name.ilike.%\${search}%\`)`:
 *
 *   search = "a%,status.eq.deleted"
 *   → .or("name.ilike.%a%,status.eq.deleted%")
 *   → matches every row with status='deleted' regardless of name
 *
 * Use this helper on EVERY user-controlled value before interpolating it
 * into a `.or(...)` or `.filter(...)` string.
 *
 * For `.eq()`, `.in()`, `.gte()`, `.lte()` etc. no sanitisation is needed
 * — those go through PostgREST's parameterised path and the value is
 * treated as a literal.
 */
export function sanitizePostgrestValue(input: string | null | undefined, maxLen = 100): string {
  if (input == null) return "";
  const cleaned = String(input)
    .replace(/[,()*:\\]/g, "") // strip PostgREST filter metacharacters
    .replace(/\s+/g, " ")      // collapse whitespace
    .trim();
  return cleaned.slice(0, maxLen);
}

/**
 * Validate that a string contains only safe characters for use as a literal
 * inside a PostgREST array filter (e.g. `trades.cs.{...}`).
 *
 * Returns null if the input contains anything other than alphanumeric chars,
 * spaces, hyphens or underscores. Use this for trade names, status labels,
 * and other enum-like values where you want to reject (not silently strip)
 * suspicious input.
 */
export function safePostgrestEnumValue(input: string, maxLen = 40): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > maxLen) return null;
  if (!/^[A-Za-z0-9 _-]+$/.test(trimmed)) return null;
  return trimmed;
}
