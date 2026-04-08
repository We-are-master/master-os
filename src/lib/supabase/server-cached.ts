import { cache } from "react";
import { createClient } from "./server";

/**
 * React.cache-wrapped Supabase server client.
 *
 * React.cache() deduplicates calls within a single render pass. A dashboard
 * page that renders 5 server components (header, list, sidebar, stats, etc.)
 * previously called `createClient()` — and therefore `cookies()` — 5 times.
 * With this wrapper, it's called exactly once per request.
 *
 * Use this in server components instead of importing `createClient` directly.
 *
 *     import { getServerSupabase } from "@/lib/supabase/server-cached";
 *     const supabase = await getServerSupabase();
 */
export const getServerSupabase = cache(async () => {
  return createClient();
});
