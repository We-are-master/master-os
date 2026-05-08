/**
 * Pre-fetches the first page for the same default tab as the client
 * (`useSupabaseList` uses `initialStatus: "draft"`). Mismatching payloads
 * would hydrate the table with unrelated rows until the first fetch.
 */
import { fetchInitialQuotes } from "@/lib/server-fetchers/quotes";
import { QuotesClient } from "./quotes-client";

export const dynamic = "force-dynamic";

export default async function QuotesPage() {
  const initialData = await fetchInitialQuotes({ status: "draft", pageSize: 10 });
  return <QuotesClient initialData={initialData} />;
}
