import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyWorkforceOnboardingToken } from "@/lib/workforce-onboarding-token";
import { getClientIp } from "@/lib/rate-limit";

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
  const { data: version } = await admin
    .from("contract_versions")
    .select("id, contract_type")
    .eq("id", contractVersionId)
    .eq("is_active", true)
    .maybeSingle();
  if (!version) return NextResponse.json({ error: "Contract not found" }, { status: 404 });

  const { data: existing } = await admin
    .from("workforce_contract_signatures")
    .select("id")
    .eq("payroll_internal_cost_id", payload.payrollInternalCostId)
    .eq("contract_version_id", contractVersionId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "Already signed", alreadySigned: true }, { status: 409 });
  }

  const cleanBase64 = signatureBase64.replace(/^data:image\/\w+;base64,/, "");
  const signatureBuffer = Buffer.from(cleanBase64, "base64");
  const signatureId = crypto.randomUUID();
  const storagePath = `${payload.payrollInternalCostId}/signatures/${signatureId}.png`;

  const { error: uploadErr } = await admin.storage.from(BUCKET).upload(storagePath, signatureBuffer, {
    contentType: "image/png",
    upsert: false,
  });
  if (uploadErr) {
    return NextResponse.json({ error: "Failed to upload signature" }, { status: 500 });
  }

  const { data: publicUrlData } = admin.storage.from(BUCKET).getPublicUrl(storagePath);
  const { error: insertErr } = await admin.from("workforce_contract_signatures").insert({
    payroll_internal_cost_id: payload.payrollInternalCostId,
    contract_version_id: contractVersionId,
    contract_type: version.contract_type,
    signer_full_name: signerFullName,
    signer_email: signerEmail,
    signature_image_url: publicUrlData.publicUrl,
    signer_ip: getClientIp(req),
    device_info: body.deviceInfo?.trim() ?? null,
  });
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
