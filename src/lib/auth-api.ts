import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";
import { isValidUUID } from "@/lib/uuid";

export { isValidUUID };

export type AuthResult = { user: User };

/**
 * Use in API Route Handlers to require an authenticated user.
 * Uses `getUser()` so the identity is verified with Supabase Auth (not only read from cookies).
 * Returns `{ user }` or a 401 NextResponse.
 */
export async function requireAuth(): Promise<AuthResult | NextResponse> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Authentication required" },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
    );
  }

  return { user };
}

