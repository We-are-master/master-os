import {
  buildRateCardPayloadFromRows,
  fetchActiveCatalogRows,
  type CatalogRateCardPayload,
} from "@/lib/catalog-rate-card-core";

export type {
  CatalogRateCardPayload as PartnerCatalogPayload,
  CatalogRateCardCategorySection as PartnerCatalogCategorySection,
  CatalogRateCardServiceRow as PartnerCatalogServiceRow,
  CatalogRateCardLine as PartnerCatalogLine,
} from "@/lib/catalog-rate-card-core";

/** Partner rate card — catalog partner pay (ceiling), grouped by category. */
export async function buildPartnerCatalogPayload(): Promise<CatalogRateCardPayload> {
  const rows = await fetchActiveCatalogRows();
  return buildRateCardPayloadFromRows(rows, "pay");
}
