import React from "react";
import { CLIENT_CATALOG_CONTENT } from "@/lib/client-catalog-content";
import type { CatalogRateCardPayload } from "@/lib/catalog-rate-card-core";
import { CatalogRateCardPDF } from "@/lib/pdf/catalog-rate-card-template";

export function ClientCatalogPDF({ payload }: { payload: CatalogRateCardPayload }) {
  return (
    <CatalogRateCardPDF
      payload={payload}
      content={CLIENT_CATALOG_CONTENT}
      docTitle="Fixfy — Client Rate Card"
    />
  );
}
