/**
 * Quotes list hydrates on the client (virtual New tab uses RPC).
 * Skipping SSR initialData avoids blocking TTFB on full draft scans.
 */
import { QuotesClient } from "./quotes-client";

export const dynamic = "force-dynamic";

export default function QuotesPage() {
  return <QuotesClient initialData={null} />;
}
