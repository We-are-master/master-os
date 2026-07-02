import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/join/resume-request-otp
 * Body: { email: string }
 *
 * Sends a 6-digit code to the given email via Supabase's built-in OTP flow
 * (same primitive the Trade Portal magic-link route uses). Only fires when
 * the email is already registered as an onboarding / inactive partner — for
 * anyone else we still return `{ ok: true }` so the endpoint cannot be used
 * to enumerate accounts on its own.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`join-resume-otp:${ip}`, 3, 10 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many code requests. Please try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ ok: true });
  }

  // Confirm the partner still qualifies for resume (onboarding / inactive).
  const service = createServiceClient();
  const { data: partner } = await service
    .from("partners")
    .select("id, status")
    .eq("email", email)
    .is("deleted_at", null)
    .maybeSingle();

  const status = String(partner?.status ?? "");
  const eligible =
    !!partner && (status === "onboarding" || status === "inactive" || status === "on_break");

  if (!eligible) return NextResponse.json({ ok: true });

  try {
    const supabase = await createClient();
    await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
  } catch (err) {
    console.error("[join/resume-request-otp] signInWithOtp error:", err);
  }

  return NextResponse.json({ ok: true });
}
