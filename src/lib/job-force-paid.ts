const FORCE_PAID_MARKER = "[FORCED_PAID_SYSTEM_OWNER]";

export function markJobAsForcePaidNote(existingNotes?: string | null): string {
  const notes = (existingNotes ?? "").trim();
  if (notes.includes(FORCE_PAID_MARKER)) return notes;
  return notes ? `${notes}\n${FORCE_PAID_MARKER}` : FORCE_PAID_MARKER;
}

export function isJobForcePaid(notes?: string | null): boolean {
  return Boolean(notes?.includes(FORCE_PAID_MARKER));
}
