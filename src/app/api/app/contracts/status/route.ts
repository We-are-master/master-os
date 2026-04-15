import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Returns which contracts the authenticated partner still needs to sign.
 * Called by the mobile app on launch to decide whether to show the
 * contract-signing gate or proceed to Main.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Resolve partner row for this auth user
  const { data: partner } = await supabase
    .from("partners")
    .select("id, email, contact_name")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!partner) {
    return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  }

  const partnerId = (partner as { id: string }).id;

  // Fetch active contract versions + partner's signatures in parallel
  const [versionsRes, signaturesRes] = await Promise.all([
    supabase
      .from("contract_versions")
      .select("id, contract_type, version, title, body_html")
      .eq("is_active", true)
      .order("contract_type"),
    supabase
      .from("partner_contract_signatures")
      .select("id, contract_version_id, contract_type, signed_at")
      .eq("partner_id", partnerId),
  ]);

  if (versionsRes.error) {
    console.error("[contracts/status] versions error:", versionsRes.error);
    return NextResponse.json({ error: "Failed to load contracts" }, { status: 500 });
  }

  const versions = (versionsRes.data ?? []) as {
    id: string;
    contract_type: string;
    version: string;
    title: string;
    body_html: string;
  }[];

  const signatures = (signaturesRes.data ?? []) as {
    id: string;
    contract_version_id: string;
    contract_type: string;
    signed_at: string;
  }[];

  const signedVersionIds = new Set(signatures.map((s) => s.contract_version_id));

  const pending = versions
    .filter((v) => !signedVersionIds.has(v.id))
    .map((v) => ({
      contractType: v.contract_type,
      versionId: v.id,
      version: v.version,
      title: v.title,
      bodyHtml: v.body_html,
    }));

  const signed = signatures.map((s) => ({
    contractType: s.contract_type,
    signedAt: s.signed_at,
    versionId: s.contract_version_id,
  }));

  return NextResponse.json({ pending, signed, partnerId });
}
