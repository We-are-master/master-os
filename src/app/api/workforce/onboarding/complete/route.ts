import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyWorkforceOnboardingToken } from "@/lib/workforce-onboarding-token";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim();
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const payload = verifyWorkforceOnboardingToken(token);
  if (!payload) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

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

  return NextResponse.json({ ok: true });
}
