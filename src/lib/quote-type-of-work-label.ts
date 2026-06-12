import { normalizeTypeOfWork } from "@/lib/type-of-work";

/** Partner-facing and list labels — prefer catalog trade over free-text quote title. */
export function resolveQuoteTypeOfWorkLabel(quote: {
  service_type?: string | null;
  title?: string | null;
}): string {
  return (
    normalizeTypeOfWork(quote.service_type) ||
    normalizeTypeOfWork(quote.title) ||
    quote.service_type?.trim() ||
    quote.title?.trim() ||
    "Quote"
  );
}
