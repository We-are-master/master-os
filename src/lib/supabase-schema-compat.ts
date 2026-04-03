/**
 * PostgREST returns PGRST204 / "Could not find … in the schema cache" when a column
 * is missing from the table or not exposed. Used to fall back to legacy inserts/selects.
 */
export function isSupabaseMissingColumnError(err: unknown, columnHint?: string): boolean {
  const msg = String((err as { message?: string })?.message ?? "");
  const code = (err as { code?: string }).code;
  const looksLikeMissingCol =
    code === "PGRST204" || msg.includes("Could not find") || msg.includes("schema cache");
  if (!looksLikeMissingCol) return false;
  if (columnHint && !msg.includes(columnHint)) return false;
  return true;
}
