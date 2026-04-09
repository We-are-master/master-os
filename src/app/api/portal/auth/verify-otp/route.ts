import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/auth/verify-otp
 * Body: { email: string, token: string }
 *
 * Alternative to the magic-link click flow: portal users can paste the
 * 6-digit code from the email instead of clicking the link. Useful when
 * the link is blocked by a corporate email filter or the user copies the
 * link to a different device.
 *
 * Supabase's signInWithOtp() sends BOTH a magic link and a 6-digit token
 * in the same email by default — no email template change needed.
 *
 * On success the SSR cookie is set via the server client and the caller
 * can redirect to /portal.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`portal-verify-otp:${ip}`, 5, 10 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Please try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let body: { email?: unknown; token?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const token = typeof body.token === "string" ? body.token.trim().replace(/\s+/g, "") : "";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  // Supabase OTP codes are 6 digits.
  if (!/^\d{6}$/.test(token)) {
    return NextResponse.json({ error: "Enter the 6-digit code from your email." }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: "email",
    });

    if (error) {
      const msg = (error.message ?? "").toLowerCase();
      // Generic + actionable — never leak whether the email exists.
      if (msg.includes("expired")) {
        return NextResponse.json(
          { error: "That code has expired. Send a new sign-in link and try again." },
          { status: 410 },
        );
      }
      return NextResponse.json(
        { error: "That code is invalid. Double-check the digits or send a new link." },
        { status: 401 },
      );
    }

    // Verify the user has a portal row. If not (e.g. an internal staff member
    // accidentally landed here), sign them straight back out so they can't
    // hold a /portal session that's actually a staff cookie.
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: portalRow } = await supabase
        .from("account_portal_users")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();
      if (!portalRow) {
        await supabase.auth.signOut();
        return NextResponse.json(
          {
            error:
              "This email is not registered as a portal user. If you're a Master team member, sign in at /login instead.",
          },
          { status: 403 },
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[portal/verify-otp] unexpected error:", err);
    return NextResponse.json(
      { error: "We could not verify your code. Please try again." },
      { status: 500 },
    );
  }
}
