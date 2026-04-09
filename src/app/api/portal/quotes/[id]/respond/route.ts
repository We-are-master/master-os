import { NextRequest, NextResponse } from "next/server";
import { requirePortalUser } from "@/lib/portal-auth";
import { fetchPortalQuoteDetail } from "@/lib/server-fetchers/portal-quotes";
import { createQuoteResponseToken } from "@/lib/quote-response-token";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/quotes/[id]/respond
 * Body: { action: "accept" | "reject", rejectionReason?: string }
 *
 * Authenticated portal-user wrapper around the existing
 * /api/quotes/respond route. Verifies the quote belongs to the caller's
 * account, then mints a fresh quote-response token and forwards the
 * request internally so all the existing accept/reject logic (job
 * creation, deposit invoice, Stripe link generation, audit logging)
 * runs through one battle-tested code path.
 *
 * Why delegate via fetch instead of importing the function directly:
 * the existing handler is a Next route handler with its own request
 * lifecycle. Wrapping it via fetch is the cleanest way to reuse it
 * without a 250-line refactor.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePortalUser();
  if (auth instanceof NextResponse) return auth;

  const { id: quoteId } = await ctx.params;
  if (!quoteId) {
    return NextResponse.json({ error: "Missing quote id" }, { status: 400 });
  }

  // Ownership check: the quote must belong to the caller's account.
  const quote = await fetchPortalQuoteDetail(quoteId, auth.accountId);
  if (!quote) {
    // Hard 404 — never reveal whether the quote exists for another account.
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  if (quote.status !== "awaiting_customer") {
    return NextResponse.json(
      { error: "This quote is no longer awaiting a response." },
      { status: 409 },
    );
  }

  let body: { action?: unknown; rejectionReason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const action = body.action;
  if (action !== "accept" && action !== "reject") {
    return NextResponse.json({ error: "Action must be accept or reject" }, { status: 400 });
  }

  // Mint a fresh response token and forward to the existing route
  const token = createQuoteResponseToken(quoteId);
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") ||
    new URL(req.url).origin;

  try {
    const upstreamRes = await fetch(`${appUrl}/api/quotes/respond`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        token,
        action,
        ...(action === "reject" && typeof body.rejectionReason === "string"
          ? { rejectionReason: body.rejectionReason }
          : {}),
      }),
    });
    const upstreamJson = await upstreamRes.json().catch(() => ({}));

    // Pass through the upstream status + body verbatim so the client gets
    // the same paymentLinkUrl / message shape it would have got from the
    // legacy email-link flow.
    return NextResponse.json(upstreamJson, { status: upstreamRes.status });
  } catch (err) {
    console.error("[portal/quotes/respond] upstream call failed:", err);
    return NextResponse.json(
      { error: "We could not process your response. Please try again." },
      { status: 502 },
    );
  }
}
