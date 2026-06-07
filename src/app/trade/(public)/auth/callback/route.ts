import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveTradePortalRedirectUrl, verifyTradePartnerSession } from "@/lib/trade-auth";

export const dynamic = "force-dynamic";

/**
 * GET /trade/auth/callback?code=...
 * Exchanges the Supabase magic-link code, verifies partner access, then redirects.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const errorCode = url.searchParams.get("error");

  if (errorCode) {
    return NextResponse.redirect(new URL(`/trade/login?error=link_expired`, req.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL(`/trade/login?error=invalid_link`, req.url));
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[trade/auth/callback] exchangeCodeForSession failed:", error);
      return NextResponse.redirect(new URL(`/trade/login?error=link_expired`, req.url));
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const partner = await verifyTradePartnerSession(user.id);
      if (!partner) {
        await supabase.auth.signOut();
        return NextResponse.redirect(new URL(`/trade/login?error=not_partner`, req.url));
      }
    }
  } catch (err) {
    console.error("[trade/auth/callback] unexpected error:", err);
    return NextResponse.redirect(new URL(`/trade/login?error=link_expired`, req.url));
  }

  return NextResponse.redirect(resolveTradePortalRedirectUrl());
}
