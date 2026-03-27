import { createClient, type User } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

/**
 * Validates a Supabase JWT from `Authorization: Bearer <token>` (mobile / non-cookie clients).
 */
export type BearerAuthResult = { user: User } | { user: null; message: string };

export async function getUserFromBearer(req: NextRequest): Promise<BearerAuthResult> {
  const raw = req.headers.get("authorization");
  if (!raw?.toLowerCase().startsWith("bearer ")) {
    return { user: null, message: "Missing Authorization Bearer token" };
  }
  const token = raw.slice(7).trim();
  if (!token) {
    return { user: null, message: "Empty Bearer token" };
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return { user: null, message: "Server misconfigured" };
  }
  const supabase = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { user: null, message: error?.message ?? "Invalid token" };
  }
  return { user };
}
