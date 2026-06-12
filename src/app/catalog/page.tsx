import { buildClientCatalogPayload } from "@/lib/client-catalog-payload";
import { ClientCatalogView } from "@/components/catalog/client-catalog-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function CatalogPage() {
  const payload = await buildClientCatalogPayload();
  return <ClientCatalogView payload={payload} />;
}
