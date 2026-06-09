import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyWorkforceOnboardingToken } from "@/lib/workforce-onboarding-token";
import { payrollUploadKeysForRow } from "@/lib/payroll-doc-checklist";

export const dynamic = "force-dynamic";

async function loadSession(token: string) {
  const payload = verifyWorkforceOnboardingToken(token);
  if (!payload) return { error: "Invalid token", status: 401 as const };

  const admin = createServiceClient();
  const { data: reqRow, error: reqErr } = await admin
    .from("workforce_onboarding_requests")
    .select("*")
    .eq("id", payload.requestId)
    .eq("payroll_internal_cost_id", payload.payrollInternalCostId)
    .maybeSingle();

  if (reqErr || !reqRow) return { error: "Request not found", status: 404 as const };
  if (reqRow.revoked_at) return { error: "Link revoked", status: 410 as const };
  if (reqRow.completed_at) return { error: "Already completed", status: 410 as const };
  if (new Date(reqRow.expires_at).getTime() < Date.now()) {
    return { error: "Link expired", status: 410 as const };
  }

  const { data: person, error: personErr } = await admin
    .from("payroll_internal_costs")
    .select(
      "id, payee_name, amount, pay_frequency, payment_day_of_month, payment_method, commission_enabled, commission_rate_percent, commission_basis, employment_type, has_equity, payroll_profile, payroll_document_files",
    )
    .eq("id", payload.payrollInternalCostId)
    .maybeSingle();

  if (personErr || !person) return { error: "Person not found", status: 404 as const };

  const now = new Date().toISOString();
  await admin
    .from("workforce_onboarding_requests")
    .update({
      first_used_at: reqRow.first_used_at ?? now,
      last_used_at: now,
      use_count: (reqRow.use_count ?? 0) + 1,
    })
    .eq("id", reqRow.id);

  const { data: contract } = await admin
    .from("contract_versions")
    .select("id, contract_type, version, title, body_html")
    .eq(
      "contract_type",
      person.employment_type === "employee" ? "workforce_employment_contract" : "workforce_service_agreement",
    )
    .eq("is_active", true)
    .maybeSingle();

  const docKeys = payrollUploadKeysForRow(person.employment_type ?? null, person.has_equity ?? false);

  return { person, contract, docKeys, requestId: reqRow.id };
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim();
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const session = await loadSession(token);
  if ("error" in session) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const { data: brandingRow } = await createServiceClient().from("company_settings").select("company_name, logo_url").maybeSingle();

  return NextResponse.json({
    person: session.person,
    contract: session.contract,
    docKeys: session.docKeys,
    branding: {
      companyName: (brandingRow as { company_name?: string } | null)?.company_name ?? "Fixfy",
      logoUrl: (brandingRow as { logo_url?: string } | null)?.logo_url ?? null,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim();
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const session = await loadSession(token);
  if ("error" in session) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const prev = (session.person.payroll_profile ?? {}) as Record<string, unknown>;
  const nextProfile = {
    ...prev,
    email: typeof body.email === "string" ? body.email.trim() : prev.email,
    phone: typeof body.phone === "string" ? body.phone.trim() : prev.phone,
    address: typeof body.address === "string" ? body.address.trim() : prev.address,
    ni_number: typeof body.ni_number === "string" ? body.ni_number.trim() : prev.ni_number,
    tax_code: typeof body.tax_code === "string" ? body.tax_code.trim() : prev.tax_code,
    utr: typeof body.utr === "string" ? body.utr.trim() : prev.utr,
    position: typeof body.position === "string" ? body.position.trim() : prev.position,
  };

  const admin = createServiceClient();
  const { error } = await admin
    .from("payroll_internal_costs")
    .update({ payroll_profile: nextProfile, updated_at: new Date().toISOString() })
    .eq("id", session.person.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
