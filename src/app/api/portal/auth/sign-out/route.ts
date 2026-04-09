import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/auth/sign-out
 * Signs the current portal user out and redirects to /portal/login.
 * Triggered by the sign-out button in the portal sidebar (form action).
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch (err) {
    console.error("[portal/sign-out] error:", err);
  }
  return NextResponse.redirect(new URL("/portal/login", req.url));
}
