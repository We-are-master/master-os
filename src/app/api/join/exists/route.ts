import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/join/exists
 * Body: { email: string }
 *
 * Fast preflight the /join wizard calls at Step 0 (Account) so it can branch
 * into the "resume onboarding" flow without wasting the user's time on
 * Business / Documents steps that would just 409 at the end.
 *
 * Response shapes:
 *   { found: false }                                           – proceed with normal signup
 *   { found: true, resume: "docs" | "reactivate", partnerId }  – open OTP resume view
 *   { found: true, canSignIn: true }                           – active account, tell them to sign in
 *
 * Note: this endpoint openly reveals whether a partner exists. That's fine —
 * the same information is already discoverable by attempting a signup, and
 * hiding it would degrade UX for legitimate returning partners.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`join-exists:${ip}`, 20, 10 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: existing } = await supabase
    .from("partners")
    .select("id, status")
    .eq("email", email)
    .is("deleted_at", null)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ found: false });
  }

  const status = String(existing.status ?? "");
  if (status === "onboarding" || status === "inactive" || status === "on_break") {
    return NextResponse.json({
      found: true,
      resume: status === "onboarding" ? "docs" : "reactivate",
      partnerId: existing.id,
    });
  }
  return NextResponse.json({ found: true, canSignIn: true });
}
