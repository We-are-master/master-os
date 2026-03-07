import { createClient, SupabaseClient } from "@supabase/supabase-js";

/** Supabase URL: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL (Vercel/Supabase docs). */
function getSupabaseUrl(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim() ||
    undefined
  );
}

/** Service role key: SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY. */
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
 */
export function createServiceClient(): SupabaseClient {
  const url = getSupabaseUrl();
  const key = getServiceRoleKey();

  if (!url || !key) {
    const missing: string[] = [];
    if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL");
    if (!key) missing.push("SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY");
    throw new Error(
      `Server config missing: ${missing.join(", ")}. In Vercel: Settings → Environment Variables — add them for the same Environment (Production/Preview) you're using, then redeploy.`
    );
  }

  return createClient(url, key);
}
