import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { selectQuoteBidForProposal } from "@/lib/quotes/select-quote-bid-for-proposal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * POST /api/quotes/select-bid-for-proposal
 *
 * Staff picks a submitted bid for the customer proposal. Updates quote partner
 * fields only — does not approve/reject bids or email the partner.
 *
 * Body: { bidId: string, quoteId: string }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { bidId?: string; quoteId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bidId = body.bidId?.trim() ?? "";
  const quoteId = body.quoteId?.trim() ?? "";
  if (!isValidUUID(bidId) || !isValidUUID(quoteId)) {
    return NextResponse.json({ error: "Valid bidId and quoteId are required" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();
    const partner = await selectQuoteBidForProposal(supabase, bidId, quoteId);
    return NextResponse.json({ ok: true, partner });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to select bid";
    console.error("[select-bid-for-proposal]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
