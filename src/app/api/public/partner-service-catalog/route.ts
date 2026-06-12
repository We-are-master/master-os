import { NextResponse } from "next/server";
import { buildPartnerCatalogPayload } from "@/lib/partner-catalog-payload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/public/partner-service-catalog — partner pay rates (no auth). */
export async function GET() {
  try {
    const payload = await buildPartnerCatalogPayload();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    console.error("[api/public/partner-service-catalog]", err);
    return NextResponse.json({ error: "Could not load partner catalog." }, { status: 500 });
  }
}
