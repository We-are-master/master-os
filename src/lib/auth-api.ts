import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

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

/**
 * Validates that a string is a valid UUID v4 format (for IDs from URL/body).
 */
export function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return typeof str === "string" && uuidRegex.test(str.trim());
}
