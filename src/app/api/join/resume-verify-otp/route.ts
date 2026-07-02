import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { partnerMissingRequiredDocs } from "@/lib/partner-docs-gate";

export const dynamic = "force-dynamic";

/**
 * POST /api/join/resume-verify-otp
 * Body: { email: string, token: string }
 *
 * Verifies the 6-digit code that /api/join/resume-request-otp sent. On success:
 *   - Sets the browser session (Supabase writes the SSR cookie).
 *   - Reactivates the partner (status: onboarding) if the account was inactive.
 *   - Returns the partner id + the list of docs still missing so the wizard
 *     can jump straight to a doc-only resume view.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`join-resume-verify:${ip}`, 6, 10 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let body: { email?: unknown; token?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const token = typeof body.token === "string" ? body.token.trim().replace(/\s+/g, "") : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  if (!/^\d{6}$/.test(token)) {
    return NextResponse.json({ error: "Enter the 6-digit code from your email." }, { status: 400 });
  }

  const supabase = await createClient();
  const { error: otpError } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (otpError) {
    const msg = (otpError.message ?? "").toLowerCase();
    if (msg.includes("expired")) {
      return NextResponse.json(
        { error: "That code has expired. Send a new code and try again." },
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
  if (!user) {
    return NextResponse.json({ error: "Could not establish session." }, { status: 500 });
  }

  // Look up the partner by email (source of truth) and, if the account was
  // deactivated, reactivate it to `onboarding` so the resume upload endpoint
  // and downstream doc listing behave like a fresh onboarding again.
  const service = createServiceClient();
  const { data: partner, error: partnerErr } = await service
    .from("partners")
    .select("id, status, partner_status_reasons, auth_user_id")
    .eq("email", email)
    .is("deleted_at", null)
    .maybeSingle();

  if (partnerErr || !partner) {
    await supabase.auth.signOut();
    return NextResponse.json(
      { error: "Could not find your partner record. Contact support." },
      { status: 404 },
    );
  }

  if (partner.status === "inactive" || partner.status === "on_break") {
    // Clear reactivation-blocking reason codes; keep any doc/compliance flags
    // so the office still sees why the partner was paused.
    const reasons = Array.isArray(partner.partner_status_reasons)
      ? (partner.partner_status_reasons as string[]).filter((r) => r !== "on_break")
      : [];
    const { error: updErr } = await service
      .from("partners")
      .update({
        status: "onboarding",
        partner_status_reasons: reasons,
        auth_user_id: partner.auth_user_id ?? user.id,
      })
      .eq("id", partner.id);
    if (updErr) {
      console.error("[join/resume-verify-otp] reactivate error:", updErr);
      return NextResponse.json({ error: "Could not reactivate your account." }, { status: 500 });
    }
  } else if (!partner.auth_user_id) {
    // Backfill: partner exists without an auth_user_id (rare edge case).
    await service.from("partners").update({ auth_user_id: user.id }).eq("id", partner.id);
  }

  const missing = await partnerMissingRequiredDocs(service, partner.id);

  return NextResponse.json({
    ok: true,
    partnerId: partner.id,
    missingDocs: missing,
    reactivated: partner.status === "inactive" || partner.status === "on_break",
  });
}
