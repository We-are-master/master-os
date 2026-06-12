import { buildPartnerCatalogPayload } from "@/lib/partner-catalog-payload";
import { PartnerCatalogView } from "@/components/catalog/partner-catalog-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PartnerCatalogPage() {
  const payload = await buildPartnerCatalogPayload();
  return <PartnerCatalogView payload={payload} />;
}
