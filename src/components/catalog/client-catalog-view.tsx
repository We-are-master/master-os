import { CLIENT_CATALOG_CONTENT } from "@/lib/client-catalog-content";
import type { CatalogRateCardPayload } from "@/lib/catalog-rate-card-core";
import { CatalogRateCardView } from "@/components/catalog/catalog-rate-card-view";

type ClientCatalogViewProps = {
  payload: CatalogRateCardPayload;
  className?: string;
};

export function ClientCatalogView({ payload, className }: ClientCatalogViewProps) {
  return <CatalogRateCardView payload={payload} content={CLIENT_CATALOG_CONTENT} className={className} />;
}
