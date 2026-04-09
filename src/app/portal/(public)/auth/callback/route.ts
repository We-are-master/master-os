import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /portal/auth/callback?code=...
 *
 * Supabase redirects here after the user clicks the magic link in their
 * email. We exchange the code for a session (which sets the auth cookie
 * via the SSR helper) then redirect to /portal.
 *
 * On any error, redirect back to /portal/login with an error flag so the
 * user knows the link was invalid/expired.
 */
export async function GET(req: NextRequest) {
  const url  = new URL(req.url);
  const code = url.searchParams.get("code");
  const errorCode = url.searchParams.get("error");

  // The Supabase redirect can include an `error` param even before reaching
  // us — pass it through to the login page.
  if (errorCode) {
    return NextResponse.redirect(new URL(`/portal/login?error=link_expired`, req.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL(`/portal/login?error=invalid_link`, req.url));
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[portal/auth/callback] exchangeCodeForSession failed:", error);
      return NextResponse.redirect(new URL(`/portal/login?error=link_expired`, req.url));
    }

    // Verify the authenticated user has a portal row. If not (e.g. an
    // internal staff member clicked the link), sign them straight back
    // out so they can't hold a /portal session that's actually a staff
    // cookie, and bounce them to /portal/login with a clear error.
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: portalRow } = await supabase
        .from("account_portal_users")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();
      if (!portalRow) {
        await supabase.auth.signOut();
        return NextResponse.redirect(new URL(`/portal/login?error=not_portal_user`, req.url));
      }
    }
  } catch (err) {
    console.error("[portal/auth/callback] unexpected error:", err);
    return NextResponse.redirect(new URL(`/portal/login?error=link_expired`, req.url));
  }

  return NextResponse.redirect(new URL(`/portal`, req.url));
}
