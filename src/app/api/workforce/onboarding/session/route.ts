import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyWorkforceOnboardingToken } from "@/lib/workforce-onboarding-token";
import {
  payrollMandatoryUploadKeysForRow,
  payrollOnboardingUploadKeysForRow,
} from "@/lib/payroll-doc-checklist";
import { parseFrontendSetup, resolveWorkforceDocumentRules } from "@/lib/frontend-setup";
import { resolveContractorAgreementHtml } from "@/lib/workforce-contractor-agreement-server";
import { PROFILE_PHOTO_DOC_KEY } from "@/lib/payroll-doc-checklist";

export const dynamic = "force-dynamic";

const DOC_BUCKET = "payroll-internal-documents";

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
  if (new Date(reqRow.expires_at).getTime() < Date.now()) {
    return { error: "Link expired", status: 410 as const };
  }

  const { data: person, error: personErr } = await admin
    .from("payroll_internal_costs")
    .select(
      "id, payee_name, description, amount, pay_frequency, payment_day_of_month, payment_method, commission_enabled, commission_rate_percent, commission_basis, employment_type, has_equity, lifecycle_stage, profile_id, payroll_profile, payroll_document_files, payout_bank_sort_code, payout_bank_account_number, payout_bank_account_holder, business_units(name)",
    )
    .eq("id", payload.payrollInternalCostId)
    .maybeSingle();

  if (personErr || !person) return { error: "Person not found", status: 404 as const };

  if (person.employment_type === "employee") {
    return {
      error: "Onboarding is for contractors only. Employees use dashboard access — contact your admin.",
      status: 403 as const,
    };
  }

  const now = new Date().toISOString();
  await admin
    .from("workforce_onboarding_requests")
    .update({
      first_used_at: reqRow.first_used_at ?? now,
      last_used_at: now,
      use_count: (reqRow.use_count ?? 0) + 1,
    })
    .eq("id", reqRow.id);

  let contract: {
    id: string;
    contract_type: string;
    version: string;
    title: string;
    body_html: string;
  } | null = null;

  if (person.employment_type === "self_employed") {
    const { data: contractRow } = await admin
      .from("contract_versions")
      .select("id, contract_type, version, title, body_html")
      .eq("contract_type", "workforce_service_agreement")
      .eq("is_active", true)
      .maybeSingle();
    if (contractRow) {
      contract = {
        ...contractRow,
        title: contractRow.title || "Independent Contractor Framework Agreement",
        body_html: resolveContractorAgreementHtml({
          payee_name: person.payee_name,
          payroll_profile: (person.payroll_profile ?? {}) as Record<string, unknown>,
        }),
      };
    }
  }

  const { data: settingsRow } = await admin.from("company_settings").select("frontend_setup").limit(1).maybeSingle();
  const workforceRules = resolveWorkforceDocumentRules(
    parseFrontendSetup(settingsRow?.frontend_setup ?? null),
  );
  const employmentType = person.employment_type ?? null;
  const hasEquity = person.has_equity ?? false;
  const docKeys = payrollOnboardingUploadKeysForRow(employmentType, hasEquity, workforceRules);
  const mandatoryDocKeys = payrollMandatoryUploadKeysForRow(employmentType, hasEquity, workforceRules).filter(
    (k) => docKeys.includes(k),
  );

  const purpose = (reqRow as { purpose?: string }).purpose ?? "invite";
  const isProfileRefresh = purpose === "profile_refresh";

  let contractSigned = false;
  if (contract?.id && !isProfileRefresh) {
    const { data: sig } = await admin
      .from("workforce_contract_signatures")
      .select("id")
      .eq("payroll_internal_cost_id", payload.payrollInternalCostId)
      .eq("contract_version_id", contract.id)
      .maybeSingle();
    contractSigned = !!sig;
  }

  return {
    person,
    contract,
    docKeys,
    mandatoryDocKeys,
    contractSigned,
    requestId: reqRow.id,
    purpose,
    isProfileRefresh,
  };
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim();
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const session = await loadSession(token);
  if ("error" in session) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const { data: brandingRow } = await createServiceClient()
    .from("company_settings")
    .select("company_name, primary_color")
    .maybeSingle();

  const branding = brandingRow as {
    company_name?: string;
    primary_color?: string | null;
  } | null;

  const contractOut = session.contract
    ? {
        ...session.contract,
        body_html:
          session.person.employment_type === "self_employed"
            ? resolveContractorAgreementHtml({
                payee_name: session.person.payee_name,
                payroll_profile: (session.person.payroll_profile ?? {}) as Record<string, unknown>,
              })
            : session.contract.body_html,
      }
    : null;

  const admin = createServiceClient();
  let profilePhotoUrl: string | null = null;
  const files = (session.person.payroll_document_files ?? {}) as Record<
    string,
    { path?: string } | undefined
  >;
  const photoPath = files[PROFILE_PHOTO_DOC_KEY]?.path;
  if (photoPath) {
    const { data: signed } = await admin.storage
      .from(DOC_BUCKET)
      .createSignedUrl(photoPath, 3600, {
        transform: { width: 256, height: 256, resize: "cover" },
      });
    profilePhotoUrl = signed?.signedUrl ?? null;
  }

  return NextResponse.json({
    person: session.person,
    contract: contractOut,
    docKeys: session.docKeys,
    mandatoryDocKeys: session.mandatoryDocKeys,
    contractSigned: session.contractSigned,
    isProfileRefresh: session.isProfileRefresh,
    profilePhotoUrl,
    branding: {
      companyName: branding?.company_name ?? "Fixfy",
      primaryColor: branding?.primary_color ?? "#ED4B00",
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
    vat_number: typeof body.vat_number === "string" ? body.vat_number.trim() : prev.vat_number,
    company_registration:
      typeof body.company_registration === "string" ? body.company_registration.trim() : prev.company_registration,
    country_of_operation:
      typeof body.country_of_operation === "string" ? body.country_of_operation.trim() : prev.country_of_operation,
    contractor_entity_type:
      body.contractor_entity_type === "company" || body.contractor_entity_type === "individual"
        ? body.contractor_entity_type
        : prev.contractor_entity_type,
  };

  const payoutUpdates: Record<string, string | null> = {};
  if (typeof body.payout_bank_account_holder === "string") {
    payoutUpdates.payout_bank_account_holder = body.payout_bank_account_holder.trim() || null;
  }
  if (typeof body.payout_bank_sort_code === "string") {
    payoutUpdates.payout_bank_sort_code = body.payout_bank_sort_code.trim() || null;
  }
  if (typeof body.payout_bank_account_number === "string") {
    payoutUpdates.payout_bank_account_number = body.payout_bank_account_number.trim() || null;
  }

  const admin = createServiceClient();
  const { error } = await admin
    .from("payroll_internal_costs")
    .update({
      payroll_profile: nextProfile,
      ...payoutUpdates,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.person.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
