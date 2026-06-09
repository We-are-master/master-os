import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { buildSchoolServiceCatalogPayload } from "@/lib/fixfy-school-service-catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/school/service-catalog — live pricing board for Fixfy School (synced with Services tab). */
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const payload = await buildSchoolServiceCatalogPayload();
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[api/school/service-catalog]", err);
    return NextResponse.json({ error: "Could not load service catalog." }, { status: 500 });
  }
}
