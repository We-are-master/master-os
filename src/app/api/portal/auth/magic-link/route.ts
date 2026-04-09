import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/auth/magic-link
 * Body: { email: string }
 *
 * Sends a Supabase magic link to the email if (and only if) it's registered.
 * Always returns the same response shape regardless of whether the email
 * exists — never confirm/deny account existence (enumeration defence).
 *
 * The user must have been invited via /api/admin/account/invite-portal-user
 * first (Phase 7). signInWithOtp with shouldCreateUser=false ensures no new
 * accounts can be created via this endpoint.
 */
export async function POST(req: NextRequest) {
  // Rate limit per IP — 3 requests per 10 min defeats spam.
  const ip = getClientIp(req);
  const rl = checkRateLimit(`portal-magic:${ip}`, 3, 10 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Please try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    // Still return ok to avoid leaking that the email was malformed.
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  try {
    const supabase = await createClient();
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") ||
      "http://localhost:3000";

    // signInWithOtp + shouldCreateUser=false:
    //  - If email exists → Supabase sends magic link, returns 200
    //  - If email does NOT exist → Supabase silently no-ops, returns 200
    // Either way we return the same shape so callers can't distinguish.
    await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${appUrl}/portal/auth/callback`,
        shouldCreateUser: false,
      },
    });
  } catch (err) {
    // Log internally but never reveal to the caller — same generic response.
    console.error("[portal/magic-link] signInWithOtp error:", err);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
