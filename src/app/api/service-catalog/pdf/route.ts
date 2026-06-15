import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { requireServiceCatalogAuth } from "@/lib/service-catalog-auth";
import { getPublishedCatalogPdfBuffer } from "@/services/client-catalog-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/service-catalog/pdf?download=1 — staff download of client rate card PDF. */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const forbidden = await requireServiceCatalogAuth(auth);
  if (forbidden) return forbidden;

  try {
    const pdf = await getPublishedCatalogPdfBuffer();
    const download = request.nextUrl.searchParams.get("download") === "1";
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": download
          ? 'attachment; filename="Fixfy-Rate-Card.pdf"'
          : 'inline; filename="Fixfy-Rate-Card.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/service-catalog/pdf]", err);
    return NextResponse.json({ error: "Could not generate PDF." }, { status: 500 });
  }
}
