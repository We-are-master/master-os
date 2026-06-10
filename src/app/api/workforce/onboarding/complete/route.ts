import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyWorkforceOnboardingToken } from "@/lib/workforce-onboarding-token";
import { ensureWorkforceDashboardAccess } from "@/lib/workforce-onboarding-access";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim();
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const payload = verifyWorkforceOnboardingToken(token);
  if (!payload) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  let password: string | undefined;
  try {
    const body = await req.json();
    if (typeof body?.password === "string") password = body.password.trim();
  } catch {
    /* optional body */
  }

  const admin = createServiceClient();
  const now = new Date().toISOString();

  const { data: person } = await admin
    .from("payroll_internal_costs")
    .select("id, payee_name, profile_id, payroll_profile, lifecycle_stage")
    .eq("id", payload.payrollInternalCostId)
    .maybeSingle();
  if (!person) return NextResponse.json({ error: "Person not found" }, { status: 404 });

  await admin
    .from("workforce_onboarding_requests")
    .update({ completed_at: now, updated_at: now })
    .eq("id", payload.requestId);

  if (person.lifecycle_stage === "onboarding") {
    await admin
      .from("payroll_internal_costs")
      .update({
        lifecycle_stage: "active",
        recurring_approved_at: now,
        updated_at: now,
      })
      .eq("id", person.id);
  }

  const { data: activated } = await admin
    .from("payroll_internal_costs")
    .select("employment_type, lifecycle_stage")
    .eq("id", person.id)
    .maybeSingle();

  if (activated?.employment_type === "self_employed") {
    const { ensureWorkforceSelfBillForPeriod } = await import("@/services/workforce-self-bills");
    await ensureWorkforceSelfBillForPeriod(person.id, new Date(), admin);
  }

  let loginEmail: string | null = null;
  if (password) {
    try {
      const access = await ensureWorkforceDashboardAccess(admin, {
        payrollInternalCostId: person.id,
        profileId: person.profile_id ?? null,
        payeeName: person.payee_name ?? null,
        payrollProfile: (person.payroll_profile ?? null) as Record<string, unknown> | null,
        password,
      });
      loginEmail = access.email;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not create platform access";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  } else if (person.profile_id) {
    await admin
      .from("profiles")
      .update({
        workforce_refresh_required: false,
        session_valid_after: null,
        updated_at: now,
      })
      .eq("id", person.profile_id);
  }

  return NextResponse.json({
    ok: true,
    autoLoginReady: !!loginEmail,
    email: loginEmail,
  });
}
