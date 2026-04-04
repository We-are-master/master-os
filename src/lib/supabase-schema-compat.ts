/**
 * True when the failure is because a column is missing / not exposed.
 *
 * - PostgREST: PGRST204 / "Could not find … in the schema cache"
 * - PostgreSQL via Supabase: `42703` / "column … does not exist" (e.g. Railway; not always PGRST204)
 */
export function isSupabaseMissingColumnError(err: unknown, columnHint?: string): boolean {
  const msg = String((err as { message?: string })?.message ?? "");
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
