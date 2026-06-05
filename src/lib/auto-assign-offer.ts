/** Default hours an auto-assign offer stays open (trade portal countdown). */
export const AUTO_ASSIGN_OFFER_HOURS_DEFAULT = 24;

export function autoAssignOfferHours(): number {
  const raw = Number(process.env.AUTO_ASSIGN_OFFER_HOURS ?? AUTO_ASSIGN_OFFER_HOURS_DEFAULT);
  if (!Number.isFinite(raw) || raw <= 0) return AUTO_ASSIGN_OFFER_HOURS_DEFAULT;
  return Math.min(168, Math.max(1, Math.round(raw)));
}

export function autoAssignExpiresAtIso(from = new Date()): string {
  const ms = autoAssignOfferHours() * 3_600_000;
  return new Date(from.getTime() + ms).toISOString();
}
