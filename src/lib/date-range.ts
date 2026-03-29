/**
 * Inclusive local calendar bounds as ISO strings for filtering `timestamptz` columns (e.g. `created_at`).
 */
export function localYmdStartIso(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return new Date(y, mo - 1, d, 0, 0, 0, 0).toISOString();
}

export function localYmdEndIso(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return new Date(y, mo - 1, d, 23, 59, 59, 999).toISOString();
}
