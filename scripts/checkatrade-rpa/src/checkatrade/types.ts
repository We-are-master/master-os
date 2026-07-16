/** One opportunity as scraped from the Checkatrade partner dashboard. */
export type CheckatradeOpportunity = {
  /** Checkatrade's own id / URL slug for this opportunity — used as the dedupe key. */
  externalId: string;
  /** "lead" = pre-quote enquiry, not yet a confirmed job. "job" = already won, needs a date/slot picked. */
  kind: "lead" | "job";
  /** Raw Checkatrade trade/category label (e.g. "Plumbing", "Electrical"). */
  category: string;
  customerName?: string;
  address?: string;
  postcode?: string;
  description?: string;
  /** Estimated/quoted value shown on the card, if any. */
  priceHint?: number;
  /** Full scraped payload, kept for logging/debugging when selectors drift. */
  raw: Record<string, unknown>;
};

/** Result of accepting a "job" opportunity and picking a date/time inside Checkatrade's own booking UI. */
export type AcceptedSlot = {
  acceptedDate: string; // YYYY-MM-DD, DD-MM-YYYY, or similar — fed straight into POST /api/jobs `date`
  acceptedTimeWindow?: string; // "HH:MM - HH:MM", fed into POST /api/jobs `arrival_time`
  /**
   * Full street address, when Checkatrade revealed one after acceptance.
   * VERIFIED (2026-07-06): the pre-accept detail page never shows more than
   * the postcode ("N7 9JQ") — no street/number. Checkatrade almost
   * certainly reveals the full address only once a job is actually
   * accepted (standard marketplace practice — don't leak the customer's
   * address before a trade commits). This couldn't be confirmed against a
   * real accept (that's a real, financially-binding action, not something
   * to do just to check a selector). If this stays undefined after a real
   * accept, dashboard/booking.ts's post-accept scrape needs a selector
   * update — check the accepted job's page structure directly.
   */
  fullAddress?: string;
  /**
   * Customer's real name, revealed in the sidebar once the job is
   * accepted (list cards and the detail page both show it post-accept —
   * before that, a job card shows no customer name at all, unlike leads).
   */
  customerName?: string;
  /**
   * The job's real, specific brief — e.g. "Window Reseal | Additional
   * notes: The first floor window is uPVC...\n\n--- Services Required
   * ---\nLarge single window reseal". This lives only on the detail page,
   * NOT the list card (the card's description is a generic, truncated
   * "This is a Checkatrade Express job..." boilerplate sentence — not
   * useful to a tradesperson). The generic boilerplate paragraph is
   * stripped out; this is just the actual job-specific content.
   */
  richDescription?: string;
};
