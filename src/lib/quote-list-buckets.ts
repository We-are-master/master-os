import type { Quote } from "@/types/database";
import { bidPayloadTrimmedString } from "@/lib/quote-bid-payload";

/** Quotes list tab **New**: any draft not yet in **Ready to send** (routing intake, partner draft, zero-value manual, etc.). */
export function isQuoteListNew(q: Quote): boolean {
  if (q.status !== "draft") return false;
  return !isQuoteReadyToSend(q);
}

/** Quotes list tab **Ready to send**: manual quote built, PDF-ready, not yet emailed. */
export function isQuoteReadyToSend(q: Quote): boolean {
  if (q.status !== "draft") return false;
  if (q.draft_route_completed !== true) return false;
  if ((q.quote_type ?? "internal") === "partner") return false;
  if (bidPayloadTrimmedString(q.customer_pdf_sent_at as unknown)) return false;
  if (!(Number(q.total_value) > 0)) return false;
  return true;
}

export type QuoteFunnelTabCounts = {
  draft: number;
  ready_to_send: number;
};

export function bucketDraftQuoteRows(
  rows: Pick<
    Quote,
    "status" | "draft_route_completed" | "quote_type" | "customer_pdf_sent_at" | "total_value"
  >[],
): QuoteFunnelTabCounts {
  let draft = 0;
  let ready_to_send = 0;
  for (const row of rows) {
    if (isQuoteListNew(row as Quote)) draft += 1;
    else if (isQuoteReadyToSend(row as Quote)) ready_to_send += 1;
  }
  return { draft, ready_to_send };
}
