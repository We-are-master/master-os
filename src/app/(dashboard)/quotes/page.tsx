/**
 * Server Component shell for the Quotes page.
 *
 * Pre-fetches the first page of the default "pipeline" tab so the kanban /
 * table renders with data on first paint. The interactive client component
 * (`quotes-client.tsx`) hydrates from this payload and only re-fetches when
 * the user changes filters/page.
 */
import { fetchInitialQuotes } from "@/lib/server-fetchers/quotes";
import { QuotesClient } from "./quotes-client";

export const dynamic = "force-dynamic";

export default async function QuotesPage() {
  const initialData = await fetchInitialQuotes({ status: "pipeline", pageSize: 10 });
  return <QuotesClient initialData={initialData} />;
}
