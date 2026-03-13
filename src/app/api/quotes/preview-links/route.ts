import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createQuoteResponseToken } from "@/lib/quote-response-token";

/**
 * GET /api/quotes/preview-links?quoteId=xxx
 * Returns the Accept and Reject URLs that will be sent to the customer (for preview in the dashboard).
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const quoteId = req.nextUrl.searchParams.get("quoteId");
    if (!quoteId || !isValidUUID(quoteId)) {
      return NextResponse.json({ error: "Valid quoteId is required" }, { status: 400 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
    const token = createQuoteResponseToken(quoteId);
    const acceptUrl = `${baseUrl}/quote/respond?token=${encodeURIComponent(token)}&action=accept`;
    const rejectUrl = `${baseUrl}/quote/respond?token=${encodeURIComponent(token)}&action=reject`;

    return NextResponse.json({ acceptUrl, rejectUrl });
  } catch (err) {
    console.error("Preview links error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
