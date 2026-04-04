/** Optional `[Label]` prefix from Record Payment / drawer — ledger display only. */
export function parseJobPaymentLedgerLabel(note: string | null | undefined): string | null {
  const t = note?.trim();
  if (!t) return null;
  const m = t.match(/^\[([^\]]+)\]/);
  return m?.[1]?.trim() || null;
}

export function jobPaymentNoteWithoutLedgerPrefix(note: string | null | undefined): string {
  const t = note?.trim() ?? "";
  return t.replace(/^\[[^\]]+\]\s*/, "").trim();
}
