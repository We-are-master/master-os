import type { Quote } from "@/types/database";

/**
 * Aba **New** da lista de quotes: todo `draft`. Desde o #531 o Ready to send não é
 * mais aba, e o rascunho pronto fica em New até Send ou Start Bidding. Precisa
 * bater com `isQuoteListNew` em `quote-list-buckets.ts`; antes este filtro ainda
 * escondia o rascunho pronto e as duas regras divergiam.
 */
type QuotesFilterQuery = {
  eq: (column: string, value: unknown) => QuotesFilterQuery;
  or: (filters: string) => QuotesFilterQuery;
  is: (column: string, value: null) => QuotesFilterQuery;
  gt: (column: string, value: number) => QuotesFilterQuery;
};

export type { QuotesFilterQuery };

/** Espelho no cliente de `applyQuotesNewTabFilter`, para testes e checagem de paridade. */
export function matchesQuotesNewTabOrFilter(
  row: Pick<
    Quote,
    "status" | "draft_route_completed" | "quote_type" | "customer_pdf_sent_at" | "total_value"
  >,
): boolean {
  return row.status === "draft";
}

/** Apply virtual **New** funnel tab filter (every `status = draft`). */
export function applyQuotesNewTabFilter<Q extends QuotesFilterQuery>(query: Q): Q {
  return query.eq("status", "draft") as Q;
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
