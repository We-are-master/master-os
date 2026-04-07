import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Module-level singleton — `createBrowserClient` is safe to share across the whole tab/session.
 *  Previously this allocated a new client on every `getSupabase()` call (called dozens of times per render),
 *  re-syncing auth state and burning CPU on hot paths. */
let cachedClient: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  if (!SUPABASE_URL?.trim() || !SUPABASE_ANON_KEY?.trim()) {
    throw new Error(
      "Supabase env missing. In Vercel: add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, and enable them for **Build** (Settings → Environment Variables)."
    );
  }
  cachedClient = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return cachedClient;
}
