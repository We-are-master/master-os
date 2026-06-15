import { CLIENT_CATALOG_CONTENT } from "@/lib/client-catalog-content";
import type { CatalogRateCardPayload } from "@/lib/catalog-rate-card-core";
import { renderCatalogRateCardHtml } from "@/lib/catalog-rate-card-html";

/** Self-contained HTML snapshot for public storage / email link. */
export function renderClientCatalogHtml(payload: CatalogRateCardPayload): string {
  return renderCatalogRateCardHtml(payload, CLIENT_CATALOG_CONTENT);
}
