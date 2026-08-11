import type { Quote } from "@/types/database";
import { bidPayloadTrimmedString } from "@/lib/quote-bid-payload";

/**
 * Quotes list tab **New**: every draft (API intake, manual create, partner path).
 * Ready-to-send is no longer a separate tab — those rows stay in New until Send or Start Bidding.
 */
export function isQuoteListNew(q: Quote): boolean {
  return q.status === "draft";
}

/**
 * @deprecated Kept for drawer context chips / helpers. Not a list tab anymore.
 * Manual quote built, PDF-ready, not yet emailed.
 */
export function isQuoteReadyToSend(q: Quote): boolean {
  if (q.status !== "draft") return false;
  if (q.draft_route_completed !== true) return false;
  if ((q.quote_type ?? "internal") === "partner") return false;
  if (bidPayloadTrimmedString(q.customer_pdf_sent_at as unknown)) return false;
  if (!(Number(q.total_value) > 0)) return false;
  return true;
}

export type QuoteFunnelTabCounts = {
  /** All draft quotes (New tab). */
  draft: number;
  /** Always 0 — Ready to send tab removed; field kept for older callers. */
  ready_to_send: number;
};

export function bucketDraftQuoteRows(
  rows: Pick<
    Quote,
    "status" | "draft_route_completed" | "quote_type" | "customer_pdf_sent_at" | "total_value"
  >[],
): QuoteFunnelTabCounts {
  let draft = 0;
  for (const row of rows) {
    if (row.status === "draft") draft += 1;
  }
  return { draft, ready_to_send: 0 };
}
