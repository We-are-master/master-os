import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { requireServiceCatalogAuth } from "@/lib/service-catalog-auth";
import { publishClientCatalogSnapshot } from "@/services/client-catalog-storage";
import { isServiceRoleConfigured } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/service-catalog/publish — upload HTML + PDF snapshot to public storage. */
export async function POST() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const forbidden = await requireServiceCatalogAuth(auth);
  if (forbidden) return forbidden;

  if (!isServiceRoleConfigured()) {
    return NextResponse.json(
      { error: "Storage not configured", message: "Service role required to publish catalog." },
      { status: 503 },
    );
  }

  try {
    const result = await publishClientCatalogSnapshot();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/service-catalog/publish]", err);
    return NextResponse.json({ error: "Could not publish catalog." }, { status: 500 });
  }
}
