import { NextResponse } from "next/server";
import { buildClientCatalogPayload } from "@/lib/client-catalog-payload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/public/service-catalog — client-facing rate card (no auth). */
export async function GET() {
  try {
    const payload = await buildClientCatalogPayload();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    console.error("[api/public/service-catalog]", err);
    return NextResponse.json({ error: "Could not load service catalog." }, { status: 500 });
  }
}
