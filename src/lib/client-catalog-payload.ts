import {
  buildRateCardPayloadFromRows,
  fetchActiveCatalogRows,
  type CatalogRateCardPayload,
} from "@/lib/catalog-rate-card-core";

export type {
  CatalogRateCardLine as ClientCatalogLine,
  CatalogRateCardLineKind as ClientCatalogLineKind,
  CatalogRateCardServiceRow as ClientCatalogServiceRow,
  CatalogRateCardCategorySection as ClientCatalogCategorySection,
  CatalogRateCardPayload as ClientCatalogPayload,
} from "@/lib/catalog-rate-card-core";

import { mapViewToRateCardRow } from "@/lib/catalog-rate-card-core";
import type { CatalogServiceCategory } from "@/lib/catalog-service-categories";
import type { ServicePricingView } from "@/lib/services-pricing-display";

export function mapViewToClientCatalogRow(
  view: ServicePricingView,
  category: CatalogServiceCategory,
) {
  return mapViewToRateCardRow(view, category, "charge");
}

/** Active catalog rows — client sell prices only, grouped by category. */
export async function buildClientCatalogPayload(): Promise<CatalogRateCardPayload> {
  const rows = await fetchActiveCatalogRows();
  return buildRateCardPayloadFromRows(rows, "charge");
}

export function buildClientCatalogPayloadFromRows(
  rows: Parameters<typeof buildRateCardPayloadFromRows>[0],
): CatalogRateCardPayload {
  return buildRateCardPayloadFromRows(rows, "charge");
}
