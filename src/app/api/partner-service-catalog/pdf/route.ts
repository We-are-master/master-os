import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { requirePartnersStaffAuth } from "@/lib/partners-staff-auth";
import { getPartnerCatalogPdfBuffer } from "@/services/partner-catalog-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const forbidden = await requirePartnersStaffAuth(auth);
  if (forbidden) return forbidden;

  try {
    const pdf = await getPartnerCatalogPdfBuffer();
    const download = request.nextUrl.searchParams.get("download") === "1";
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": download
          ? 'attachment; filename="Fixfy-Partner-Rate-Card.pdf"'
          : 'inline; filename="Fixfy-Partner-Rate-Card.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/partner-service-catalog/pdf]", err);
    return NextResponse.json({ error: "Could not generate PDF." }, { status: 500 });
  }
}
