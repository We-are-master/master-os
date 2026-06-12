import { PARTNER_CATALOG_CONTENT } from "@/lib/partner-catalog-content";
import type { CatalogRateCardPayload } from "@/lib/catalog-rate-card-core";
import { CatalogRateCardView } from "@/components/catalog/catalog-rate-card-view";

type PartnerCatalogViewProps = {
  payload: CatalogRateCardPayload;
  className?: string;
};

export function PartnerCatalogView({ payload, className }: PartnerCatalogViewProps) {
  return <CatalogRateCardView payload={payload} content={PARTNER_CATALOG_CONTENT} className={className} />;
}
