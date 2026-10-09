import { buildClientCatalogPayload } from "@/lib/client-catalog-payload";
import { CLIENT_CATALOG_CONTENT } from "@/lib/client-catalog-content";
import { CatalogRateCardView } from "@/components/catalog/catalog-rate-card-view";
import { DESCONTO_B2B_PCT, nomeParaTabela, payloadB2B } from "@/lib/catalogo-b2b";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Tabela de parceiro: Services do OS com 5% abaixo da tabela (Fase 3). */
export default async function PartnerPriceListPage({ searchParams }: { searchParams: Promise<{ for?: string }> }) {
  const { for: para } = await searchParams;
  const empresa = nomeParaTabela(para);
  const payload = payloadB2B(await buildClientCatalogPayload());
  const content = {
    ...CLIENT_CATALOG_CONTENT,
    hero: {
      ...CLIENT_CATALOG_CONTENT.hero,
      kicker: empresa ? `Partner price list · ${empresa}` : "Partner price list",
      subtitle: `Partner rates: every price is ${DESCONTO_B2B_PCT}% below our standard prices, agreed up front. One invoice on your terms, a vetted team on every job.`,
    },
    pricingIntro: {
      ...CLIENT_CATALOG_CONTENT.pricingIntro,
      kicker: "Partner rates",
      lede: `${DESCONTO_B2B_PCT}% below our standard prices. All prices include VAT unless stated otherwise. Anything not listed is quoted by our team before anyone is booked.`,
    },
    priceLabel: "Partner rate",
  };
  return <CatalogRateCardView payload={payload} content={content} />;
}
