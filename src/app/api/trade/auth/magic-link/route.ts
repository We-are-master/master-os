import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/trade/auth/magic-link
 * Body: { email: string }
 *
 * Sends a Supabase OTP email to registered partner app users only
 * (`shouldCreateUser: false`). Response is always opaque.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`trade-magic:${ip}`, 3, 10 * 60 * 1000);
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
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  try {
    const supabase = await createClient();
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") || "http://localhost:3000";

    await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${appUrl}/trade/auth/callback`,
        shouldCreateUser: false,
      },
    });
  } catch (err) {
    console.error("[trade/magic-link] signInWithOtp error:", err);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
