import React from "react";
import { PARTNER_CATALOG_CONTENT } from "@/lib/partner-catalog-content";
import type { CatalogRateCardPayload } from "@/lib/catalog-rate-card-core";
import { CatalogRateCardPDF } from "@/lib/pdf/catalog-rate-card-template";

export function PartnerCatalogPDF({ payload }: { payload: CatalogRateCardPayload }) {
  return (
    <CatalogRateCardPDF
      payload={payload}
      content={PARTNER_CATALOG_CONTENT}
      docTitle="Fixfy — Partner Rate Card"
    />
  );
}
