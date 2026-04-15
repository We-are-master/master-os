import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Partner signs one contract. Receives the drawn signature as base64 PNG,
 * uploads it to Supabase Storage, and creates an immutable signature record
 * with full audit trail (IP, device, timestamp, signer identity).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    contractVersionId?: string;
    signerFullName?: string;
    signatureImageBase64?: string;
    deviceInfo?: string;
    partnerId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const contractVersionId = body.contractVersionId?.trim();
  const signerFullName = body.signerFullName?.trim();
  const signatureBase64 = body.signatureImageBase64?.trim();
  const deviceInfo = body.deviceInfo?.trim() ?? null;
  const partnerId = body.partnerId?.trim();

  if (!contractVersionId) return NextResponse.json({ error: "contractVersionId required" }, { status: 400 });
  if (!signerFullName) return NextResponse.json({ error: "signerFullName required" }, { status: 400 });
  if (!signatureBase64) return NextResponse.json({ error: "signatureImageBase64 required" }, { status: 400 });
  if (!partnerId) return NextResponse.json({ error: "partnerId required" }, { status: 400 });

  const admin = createServiceClient();

  // Verify contract version exists and is active
  const { data: version, error: versionErr } = await admin
    .from("contract_versions")
    .select("id, contract_type, version, title")
    .eq("id", contractVersionId)
    .eq("is_active", true)
    .maybeSingle();

  if (versionErr || !version) {
    return NextResponse.json({ error: "Contract version not found or inactive" }, { status: 404 });
  }

  const cv = version as { id: string; contract_type: string; version: string; title: string };

  // Verify partner exists and belongs to the authenticated user
  const { data: partner } = await admin
    .from("partners")
    .select("id, email, contact_name, auth_user_id")
    .eq("id", partnerId)
    .maybeSingle();

  if (!partner || (partner as { auth_user_id?: string }).auth_user_id !== user.id) {
    return NextResponse.json({ error: "Partner not found or not owned by user" }, { status: 403 });
  }

  const partnerEmail = (partner as { email: string }).email;

  // Check if already signed this version
  const { data: existing } = await admin
    .from("partner_contract_signatures")
    .select("id")
    .eq("partner_id", partnerId)
    .eq("contract_version_id", contractVersionId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "Already signed", alreadySigned: true }, { status: 409 });
  }

  // Decode base64 and upload signature image to storage
  const cleanBase64 = signatureBase64.replace(/^data:image\/\w+;base64,/, "");
  const signatureBuffer = Buffer.from(cleanBase64, "base64");
  const signatureId = crypto.randomUUID();
  const storagePath = `${partnerId}/signatures/${signatureId}.png`;

  const { error: uploadErr } = await admin.storage
    .from("partner-documents")
    .upload(storagePath, signatureBuffer, {
      contentType: "image/png",
      upsert: false,
    });

  if (uploadErr) {
    console.error("[contracts/sign] upload error:", uploadErr);
    return NextResponse.json({ error: "Failed to upload signature" }, { status: 500 });
  }

  const { data: publicUrlData } = admin.storage
    .from("partner-documents")
    .getPublicUrl(storagePath);
  const signatureImageUrl = publicUrlData.publicUrl;

  // Create signature record
  const signerIp = getClientIp(req);
  const signedAt = new Date().toISOString();

  const { data: signature, error: insertErr } = await admin
    .from("partner_contract_signatures")
    .insert({
      partner_id: partnerId,
      contract_version_id: contractVersionId,
      contract_type: cv.contract_type,
      signer_full_name: signerFullName,
      signer_email: partnerEmail,
      signature_image_url: signatureImageUrl,
      signer_ip: signerIp,
      device_info: deviceInfo,
      signed_at: signedAt,
    })
    .select("id")
    .single();

  if (insertErr) {
    console.error("[contracts/sign] insert error:", insertErr);
    return NextResponse.json({ error: "Failed to save signature" }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    signatureId: (signature as { id: string }).id,
    contractType: cv.contract_type,
    signedAt,
  });
}
