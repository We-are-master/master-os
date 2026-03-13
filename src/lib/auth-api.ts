import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { User, Session } from "@supabase/supabase-js";

export type AuthResult = { user: User; session: Session };

/**
 * Use in API Route Handlers to require an authenticated user.
 * Returns { user, session } or a 401 NextResponse.
 * Uses server Supabase client (request cookies).
 */
export async function requireAuth(): Promise<AuthResult | NextResponse> {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;

  if (!user || !session) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Authentication required" },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
    );
  }

  return { user, session };
}

/**
 * Validates that a string is a valid UUID v4 format (for IDs from URL/body).
 */
export function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return typeof str === "string" && uuidRegex.test(str.trim());
}
