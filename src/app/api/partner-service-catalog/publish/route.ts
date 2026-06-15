import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { requirePartnersStaffAuth } from "@/lib/partners-staff-auth";
import { publishPartnerCatalogSnapshot } from "@/services/partner-catalog-storage";
import { isServiceRoleConfigured } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const forbidden = await requirePartnersStaffAuth(auth);
  if (forbidden) return forbidden;

  if (!isServiceRoleConfigured()) {
    return NextResponse.json(
      { error: "Storage not configured", message: "Service role required to publish catalog." },
      { status: 503 },
    );
  }

  try {
    const result = await publishPartnerCatalogSnapshot();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/partner-service-catalog/publish]", err);
    return NextResponse.json({ error: "Could not publish partner catalog." }, { status: 500 });
  }
}
