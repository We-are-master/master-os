import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyWorkforceOnboardingToken } from "@/lib/workforce-onboarding-token";
import { getClientIp } from "@/lib/rate-limit";
import { renderWorkforceSignedContractPdf } from "@/lib/workforce-contract-pdf-server";
import { resolveContractorAgreementHtml } from "@/lib/workforce-contractor-agreement-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BUCKET = "payroll-internal-documents";

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim();
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const payload = verifyWorkforceOnboardingToken(token);
  if (!payload) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  let body: {
    contractVersionId?: string;
    signerFullName?: string;
    signatureImageBase64?: string;
    deviceInfo?: string;
    signerEmail?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const contractVersionId = body.contractVersionId?.trim();
  const signerFullName = body.signerFullName?.trim();
  const signatureBase64 = body.signatureImageBase64?.trim();
  const signerEmail = body.signerEmail?.trim();
  if (!contractVersionId || !signerFullName || !signatureBase64 || !signerEmail) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const admin = createServiceClient();

  const { data: reqRow } = await admin
    .from("workforce_onboarding_requests")
    .select("purpose")
    .eq("id", payload.requestId)
    .eq("payroll_internal_cost_id", payload.payrollInternalCostId)
    .maybeSingle();
  const isProfileRefresh = (reqRow as { purpose?: string } | null)?.purpose === "profile_refresh";

  const { data: version } = await admin
    .from("contract_versions")
    .select("id, contract_type, version, title, body_html")
    .eq("id", contractVersionId)
    .eq("is_active", true)
    .maybeSingle();
  if (!version) return NextResponse.json({ error: "Contract not found" }, { status: 404 });

  const cv = version as {
    id: string;
    contract_type: string;
    version: string;
    title: string;
    body_html: string;
  };

  const { data: existing } = await admin
    .from("workforce_contract_signatures")
    .select("id")
    .eq("payroll_internal_cost_id", payload.payrollInternalCostId)
    .eq("contract_version_id", contractVersionId)
    .maybeSingle();
  if (existing && !isProfileRefresh) {
    return NextResponse.json({ error: "Already signed", alreadySigned: true }, { status: 409 });
  }

  const cleanBase64 = signatureBase64.replace(/^data:image\/\w+;base64,/, "");
  const signatureBuffer = Buffer.from(cleanBase64, "base64");
  const signatureId = crypto.randomUUID();
  const signatureStoragePath = `${payload.payrollInternalCostId}/signatures/${signatureId}.png`;

  const { error: uploadErr } = await admin.storage.from(BUCKET).upload(signatureStoragePath, signatureBuffer, {
    contentType: "image/png",
    upsert: false,
  });
  if (uploadErr) {
    return NextResponse.json({ error: "Failed to upload signature" }, { status: 500 });
  }

  const { data: publicUrlData } = admin.storage.from(BUCKET).getPublicUrl(signatureStoragePath);
  const signerIp = getClientIp(req);
  const signedAt = new Date().toISOString();
  const deviceInfo = body.deviceInfo?.trim() ?? null;

  const { data: personRow } = await admin
    .from("payroll_internal_costs")
    .select("payee_name, payroll_profile, employment_type")
    .eq("id", payload.payrollInternalCostId)
    .maybeSingle();

  const { data: brandingRow } = await admin
    .from("company_settings")
    .select("company_name")
    .limit(1)
    .maybeSingle();
  const companyName =
    (brandingRow as { company_name?: string } | null)?.company_name?.trim() || "Fixfy";

  const contractBodyHtml =
    (personRow as { employment_type?: string } | null)?.employment_type === "self_employed"
      ? resolveContractorAgreementHtml(
          {
            payee_name: (personRow as { payee_name?: string } | null)?.payee_name,
            payroll_profile: (personRow as { payroll_profile?: Record<string, unknown> } | null)?.payroll_profile,
          },
          { agreementDate: new Date(signedAt) },
        )
      : cv.body_html;

  let signaturePdfUrl: string | null = null;
  try {
    const pdfBuffer = await renderWorkforceSignedContractPdf({
      companyName,
      contractTitle: cv.title,
      contractVersion: cv.version,
      contractType: cv.contract_type,
      bodyHtml: contractBodyHtml,
      signerFullName,
      signerEmail,
      signedAt,
      signerIp,
      deviceInfo,
      signatureImageBase64: signatureBase64,
      contractVersionId: cv.id,
    });

    const pdfStoragePath = `${payload.payrollInternalCostId}/contracts/${signatureId}.pdf`;
    const { error: pdfUploadErr } = await admin.storage.from(BUCKET).upload(pdfStoragePath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (pdfUploadErr) {
      console.error("[workforce/onboarding/sign] pdf upload:", pdfUploadErr);
    } else {
      const { data: pdfPublicUrl } = admin.storage.from(BUCKET).getPublicUrl(pdfStoragePath);
      signaturePdfUrl = pdfPublicUrl.publicUrl;
    }
  } catch (pdfErr) {
    console.error("[workforce/onboarding/sign] pdf generation:", pdfErr);
  }

  const signatureFields = {
    signer_full_name: signerFullName,
    signer_email: signerEmail,
    signature_image_url: publicUrlData.publicUrl,
    signature_pdf_url: signaturePdfUrl,
    signer_ip: signerIp,
    device_info: deviceInfo,
    signed_at: signedAt,
  };

  let signatureRecordId: string;

  if (existing && isProfileRefresh) {
    const { error: updateErr } = await admin
      .from("workforce_contract_signatures")
      .update(signatureFields)
      .eq("id", existing.id);
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
    signatureRecordId = existing.id;
  } else {
    const { data: inserted, error: insertErr } = await admin
      .from("workforce_contract_signatures")
      .insert({
        payroll_internal_cost_id: payload.payrollInternalCostId,
        contract_version_id: contractVersionId,
        contract_type: cv.contract_type,
        ...signatureFields,
      })
      .select("id")
      .single();
    if (insertErr || !inserted) {
      return NextResponse.json({ error: insertErr?.message ?? "Failed to save signature" }, { status: 500 });
    }
    signatureRecordId = (inserted as { id: string }).id;
  }

  return NextResponse.json({
    ok: true,
    signatureId: signatureRecordId,
    signatureImageUrl: publicUrlData.publicUrl,
    signaturePdfUrl,
    signedAt,
    signerIp,
    audit: {
      signerFullName,
      signerEmail,
      signedAt,
      signerIp,
      deviceInfo,
      contractVersionId: cv.id,
      contractType: cv.contract_type,
    },
  });
}
