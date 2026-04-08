/**
 * Server Component shell for the Requests page.
 *
 * Pre-fetches the first page of service requests via the consolidated RPC
 * (`get_requests_list_bundle`, migration 125) so the table is rendered with
 * data on first paint. The interactive client component then hydrates from
 * this payload and only re-fetches when the user changes filters/page.
 *
 * The legacy client logic lives in `requests-client.tsx` (kept fully intact
 * to minimise risk). This file is the thin server wrapper.
 */
import { fetchInitialRequests } from "@/lib/server-fetchers/requests";
import { RequestsClient } from "./requests-client";

// Always render fresh on the server. The list is highly mutable (status
// changes, new requests, deletes via the realtime channel) so caching at the
// page level would just hide updates.
export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const initialData = await fetchInitialRequests({ pageSize: 10 });
  return <RequestsClient initialData={initialData} />;
}
