/**
 * Server Component shell for the Partners page.
 *
 * Pre-fetches the first page (default tab = "all", trade = "all") via the
 * consolidated `get_partners_list_bundle` RPC. The 5k-line client component
 * (`partners-client.tsx`) hydrates from this payload — its first paint is
 * a fully populated table instead of a loading skeleton waiting on a
 * client-side waterfall.
 */
import { fetchInitialPartners } from "@/lib/server-fetchers/partners";
import { PartnersClient } from "./partners-client";

export const dynamic = "force-dynamic";

export default async function PartnersPage() {
  const initialData = await fetchInitialPartners({ pageSize: 10 });
  return <PartnersClient initialData={initialData} />;
}
