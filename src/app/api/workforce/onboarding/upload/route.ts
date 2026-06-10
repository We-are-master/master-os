import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyWorkforceOnboardingToken } from "@/lib/workforce-onboarding-token";
import { payrollOnboardingUploadKeysForRow, PROFILE_PHOTO_DOC_KEY } from "@/lib/payroll-doc-checklist";
import { parseFrontendSetup, resolveWorkforceDocumentRules } from "@/lib/frontend-setup";

export const dynamic = "force-dynamic";

const BUCKET = "payroll-internal-documents";
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim();
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const payload = verifyWorkforceOnboardingToken(token);
  if (!payload) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const form = await req.formData();
  const docKey = String(form.get("docKey") ?? "").trim();
  const file = form.get("file");
  if (!docKey || !(file instanceof File)) {
    return NextResponse.json({ error: "docKey and file required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File must be 10 MB or less" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { data: personRow } = await admin
    .from("payroll_internal_costs")
    .select("employment_type, has_equity")
    .eq("id", payload.payrollInternalCostId)
    .maybeSingle();
  const { data: settingsRow } = await admin.from("company_settings").select("frontend_setup").limit(1).maybeSingle();
  const workforceRules = resolveWorkforceDocumentRules(
    parseFrontendSetup(settingsRow?.frontend_setup ?? null),
  );
  const allowed = [
    ...payrollOnboardingUploadKeysForRow(
      personRow?.employment_type ?? null,
      personRow?.has_equity ?? false,
      workforceRules,
    ),
    PROFILE_PHOTO_DOC_KEY,
  ];
  if (!allowed.includes(docKey)) {
    return NextResponse.json({ error: "This document is not required for upload" }, { status: 400 });
  }

  const path = `${payload.payrollInternalCostId}/${docKey}/${file.name.replace(/[^\w.\-]+/g, "_")}`;
  const { error: uploadErr } = await admin.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || "application/octet-stream",
  });
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

  const { data: person } = await admin
    .from("payroll_internal_costs")
    .select("payroll_document_files")
    .eq("id", payload.payrollInternalCostId)
    .maybeSingle();
  const prev = (person?.payroll_document_files ?? {}) as Record<string, { path: string; file_name: string }>;
  const next = { ...prev, [docKey]: { path, file_name: file.name } };

  const { error: updateErr } = await admin
    .from("payroll_internal_costs")
    .update({ payroll_document_files: next, updated_at: new Date().toISOString() })
    .eq("id", payload.payrollInternalCostId);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
