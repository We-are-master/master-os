import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createPartnerBidToken } from "@/lib/quote-response-token";
import { upsertShortLink } from "@/lib/short-links";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * GET /api/quotes/[id]/partner-bid-link?partnerId=<uuid>
 *
 * Returns the public bid-submission URL for the given partner on a quote.
 * Each invited partner gets their own URL so bids are traceable to the
 * specific partner the office shared the link with.
 *
 * Auth: admin/manager/operator only.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  const { id: quoteId } = await ctx.params;
  if (!isValidUUID(quoteId)) {
    return NextResponse.json({ error: "Invalid quote id" }, { status: 400 });
  }
  const partnerId = req.nextUrl.searchParams.get("partnerId")?.trim() ?? "";
  if (!isValidUUID(partnerId)) {
    return NextResponse.json({ error: "Valid partnerId is required" }, { status: 400 });
  }

  const admin = createServiceClient();
  const [{ data: quote }, { data: partner }] = await Promise.all([
    admin.from("quotes").select("id, reference, status").eq("id", quoteId).is("deleted_at", null).maybeSingle(),
    admin.from("partners").select("id, contact_name, company_name, email").eq("id", partnerId).maybeSingle(),
  ]);

  if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  if (!partner) return NextResponse.json({ error: "Partner not found" }, { status: 404 });

  const token = createPartnerBidToken(quote.id, partner.id);
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") || "";
  // Semantic /quote/bid path for partner bid submission (rewrites to the
  // same /quote/respond page internally).
  const targetPath = `/quote/bid?token=${encodeURIComponent(token)}`;

  let shortPath = targetPath;
  try {
    const result = await upsertShortLink({
      targetPath,
      kind:       "partner_bid",
      entityRef:  `quote:${quote.id}:partner:${partner.id}`,
      createdBy:  auth.user.id,
    });
    shortPath = result.shortPath;
  } catch (err) {
    console.error("[partner-bid-link] short link upsert failed, falling back to long URL:", err);
  }

  return NextResponse.json({
    url:           `${base}${shortPath}`,
    longUrl:       `${base}${targetPath}`,
    partnerId:     partner.id,
    partnerName:   partner.company_name?.trim() || partner.contact_name?.trim() || null,
    partnerEmail:  partner.email ?? null,
    quoteReference: quote.reference,
    quoteStatus:    quote.status,
  });
}
