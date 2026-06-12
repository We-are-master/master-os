import type { Quote } from "@/types/database";
import { bidPayloadTrimmedString } from "@/lib/quote-bid-payload";

/**
 * PostgREST `or()` for **New** tab — logical NOT of **Ready to send** (draft rows only).
 * Must stay equivalent to `isQuoteListNew` in `quote-list-buckets.ts`.
 */
export const QUOTES_NEW_TAB_OR_FILTER =
  "draft_route_completed.is.null,draft_route_completed.eq.false,quote_type.eq.partner,customer_pdf_sent_at.not.is.null,total_value.is.null,total_value.lte.0";

type QuotesFilterQuery = {
  eq: (column: string, value: unknown) => QuotesFilterQuery;
  or: (filters: string) => QuotesFilterQuery;
  is: (column: string, value: null) => QuotesFilterQuery;
  gt: (column: string, value: number) => QuotesFilterQuery;
};

export type { QuotesFilterQuery };

/** Client-side mirror of `QUOTES_NEW_TAB_OR_FILTER` — for tests and parity checks. */
export function matchesQuotesNewTabOrFilter(
  row: Pick<
    Quote,
    "status" | "draft_route_completed" | "quote_type" | "customer_pdf_sent_at" | "total_value"
  >,
): boolean {
  if (row.status !== "draft") return false;
  if (row.draft_route_completed == null) return true;
  if (row.draft_route_completed === false) return true;
  if ((row.quote_type ?? "internal") === "partner") return true;
  if (bidPayloadTrimmedString(row.customer_pdf_sent_at as unknown)) return true;
  const tv = row.total_value;
  if (tv == null) return true;
  if (Number(tv) <= 0) return true;
  return false;
}

/** Apply virtual **New** funnel tab filter (subset of `status = draft`). */
export function applyQuotesNewTabFilter<Q extends QuotesFilterQuery>(query: Q): Q {
  return query.eq("status", "draft").or(QUOTES_NEW_TAB_OR_FILTER) as Q;
}

/** Apply virtual **Ready to send** funnel tab filter. */
export function applyQuotesReadyToSendTabFilter<Q extends QuotesFilterQuery>(query: Q): Q {
  return query
    .eq("status", "draft")
    .eq("draft_route_completed", true)
    .or("quote_type.is.null,quote_type.neq.partner")
    .is("customer_pdf_sent_at", null)
    .gt("total_value", 0) as Q;
}
