import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Service role key for server-only API routes.
 * Accepts SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY (common in production).
 */
function getServiceRoleKey(): string | undefined {
  return (
    process.env.SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    undefined
  );
}

/**
 * Creates a Supabase client with the service role (bypasses RLS).
 * Use only in API routes / server code. Never expose this key to the client.
 *
 * In production, set SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY in your
 * host's environment variables (e.g. Vercel → Settings → Environment Variables).
 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = getServiceRoleKey();

  if (!url || !key) {
    throw new Error(
      "Server config: NEXT_PUBLIC_SUPABASE_URL and SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY) are required. Add them in your deployment environment variables (e.g. Vercel → Settings → Environment Variables)."
    );
  }

  return createClient(url, key);
}
