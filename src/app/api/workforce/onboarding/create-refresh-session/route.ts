import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createWorkforceOnboardingToken } from "@/lib/workforce-onboarding-token";

export const dynamic = "force-dynamic";

const REFRESH_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export async function POST() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const admin = createServiceClient();
  const now = new Date().toISOString();

  const { data: person, error: personErr } = await admin
    .from("payroll_internal_costs")
    .select("id, payee_name, payroll_profile, employment_type")
    .eq("profile_id", auth.user.id)
    .maybeSingle();

  if (personErr) {
    return NextResponse.json({ error: personErr.message }, { status: 500 });
  }

  if (!person) {
    await admin
      .from("profiles")
      .update({
        workforce_refresh_required: false,
        session_valid_after: null,
        updated_at: now,
      })
      .eq("id", auth.user.id);
    return NextResponse.json({ ok: true, cleared: true });
  }

  if ((person as { employment_type?: string }).employment_type !== "self_employed") {
    await admin
      .from("profiles")
      .update({
        workforce_refresh_required: false,
        session_valid_after: null,
        updated_at: now,
      })
      .eq("id", auth.user.id);
    return NextResponse.json({ ok: true, cleared: true });
  }

  await admin
    .from("workforce_onboarding_requests")
    .update({ revoked_at: now, updated_at: now })
    .eq("payroll_internal_cost_id", person.id)
    .eq("purpose", "profile_refresh")
    .is("completed_at", null)
    .is("revoked_at", null);

  const profileEmail =
    auth.user.email?.trim().toLowerCase() ||
    String((person.payroll_profile as { email?: string } | null)?.email ?? "").trim().toLowerCase();

  const expiresAt = new Date(Date.now() + REFRESH_EXPIRY_MS).toISOString();
  const { data: requestRow, error: insErr } = await admin
    .from("workforce_onboarding_requests")
    .insert({
      payroll_internal_cost_id: person.id,
      requested_by: auth.user.id,
      sent_to_email: profileEmail || null,
      expires_at: expiresAt,
      purpose: "profile_refresh",
    })
    .select("id")
    .single();

  if (insErr || !requestRow) {
    return NextResponse.json(
      { error: insErr?.message ?? "Could not create refresh session" },
      { status: 500 },
    );
  }

  const token = createWorkforceOnboardingToken({
    requestId: requestRow.id,
    payrollInternalCostId: person.id,
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
  const onboardingUrl = `${baseUrl}/onboard/${encodeURIComponent(token)}`;

  return NextResponse.json({ ok: true, onboardingUrl });
}
