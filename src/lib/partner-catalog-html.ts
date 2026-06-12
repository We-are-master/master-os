import { PARTNER_CATALOG_CONTENT } from "@/lib/partner-catalog-content";
import type { CatalogRateCardPayload } from "@/lib/catalog-rate-card-core";
import { renderCatalogRateCardHtml } from "@/lib/catalog-rate-card-html";

export function renderPartnerCatalogHtml(payload: CatalogRateCardPayload): string {
  return renderCatalogRateCardHtml(payload, PARTNER_CATALOG_CONTENT);
}
