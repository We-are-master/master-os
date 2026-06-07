import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { verifyTradePartnerSession } from "@/lib/trade-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/trade/auth/verify-otp
 * Body: { email: string, token: string }
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`trade-verify-otp:${ip}`, 5, 10 * 60 * 1000);
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
      if (msg.includes("expired")) {
        return NextResponse.json(
          { error: "That code has expired. Send a new sign-in code and try again." },
          { status: 410 },
        );
      }
      return NextResponse.json(
        { error: "That code is invalid. Double-check the digits or send a new code." },
        { status: 401 },
      );
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const partner = await verifyTradePartnerSession(user.id);
      if (!partner) {
        await supabase.auth.signOut();
        return NextResponse.json(
          {
            error:
              "This email is not linked to a Fixfy Trade partner account. Apply at /join or contact support.",
          },
          { status: 403 },
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[trade/verify-otp] unexpected error:", err);
    return NextResponse.json(
      { error: "We could not verify your code. Please try again." },
      { status: 500 },
    );
  }
}
