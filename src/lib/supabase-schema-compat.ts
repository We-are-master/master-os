/**
 * True when the failure is because a column is missing / not exposed.
 *
 * - PostgREST: PGRST204 / "Could not find … in the schema cache"
 * - PostgreSQL via Supabase: `42703` / "column … does not exist" (e.g. Railway; not always PGRST204)
 */

/** Full error text for PostgREST / Postgres messages (some clients put detail in `details`). */
export function postgrestFullErrorText(err: unknown): string {
  if (typeof err !== "object" || err === null) return String(err ?? "");
  const o = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
  const parts = [o.message, o.details, o.hint, o.code].map((x) => (typeof x === "string" ? x : ""));
  return parts.join(" ").replace(/\u2018|\u2019/g, "'");
}

/**
 * PostgREST PGRST204 text, e.g. `Could not find the 'notes' column of 'quote_line_items' in the schema cache`.
 * Returns the column name so callers can retry without that key.
 */
export function parsePostgrestUnknownColumnName(err: unknown): string | null {
  const msg = postgrestFullErrorText(err);
  let m = msg.match(/Could not find the ['"](\w+)['"]\s+column/i);
  if (!m) m = msg.match(/Could not find the (\w+)\s+column/i);
  return m?.[1] ?? null;
}

export function isSupabaseMissingColumnError(err: unknown, columnHint?: string): boolean {
  const msg = postgrestFullErrorText(err);
  const code = String((err as { code?: string })?.code ?? "");
  const lower = msg.toLowerCase();
  const postgresUndefinedColumn =
    code === "42703" ||
    /\bcolumn\s+[\w.]+\s+does not exist\b/i.test(msg) ||
    (lower.includes("does not exist") && lower.includes("column"));
  const looksLikeMissingCol =
    code === "PGRST204" ||
    msg.includes("Could not find") ||
    msg.includes("schema cache") ||
    postgresUndefinedColumn;
  if (!looksLikeMissingCol) return false;
  if (columnHint && !msg.includes(columnHint)) return false;
  return true;
}

/**
 * True when a Supabase error was caused by `job_payments.deleted_at` not
 * existing (older DBs without migration 080). PostgREST returns 42703
 * "undefined column" but some cache layers strip the code — so we also
 * string-match on the column name.
 */
export function isJobPaymentsDeletedAtMissing(err: unknown): boolean {
  if (!err) return false;
  const code = String((err as { code?: string })?.code ?? "");
  if (code === "42703") return true;
  return isSupabaseMissingColumnError(err, "deleted_at");
}
