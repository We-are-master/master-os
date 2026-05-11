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
 * GET /api/quotes/[id]/invited-partners
 *
 * Returns the partners invited to bid on this quote with each partner's
 * unique bid URL, the partner's contact info, and whether they have
 * already submitted a bid. Powers the "Bid links" modal on the Bids tab.
 *
 * Auth: admin/manager/operator only.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  const admin = createServiceClient();

  const [{ data: quote }, { data: invitations }, { data: bids }] = await Promise.all([
    admin.from("quotes").select("id, reference, status").eq("id", quoteId).is("deleted_at", null).maybeSingle(),
    admin
      .from("quote_partner_invitations")
      .select("partner_id, invited_at, last_invited_at, last_channel, partners ( id, contact_name, company_name, email )")
      .eq("quote_id", quoteId)
      .order("invited_at", { ascending: true }),
    admin
      .from("quote_bids")
      .select("partner_id, bid_amount, status, updated_at")
      .eq("quote_id", quoteId),
  ]);

  if (!quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") || "";
  const bidsByPartner = new Map<string, { amount: number; status: string; updatedAt: string }>();
  for (const b of bids ?? []) {
    const partnerId = (b as { partner_id: string }).partner_id;
    bidsByPartner.set(partnerId, {
      amount:    Number((b as { bid_amount: number }).bid_amount) || 0,
      status:    String((b as { status: string }).status ?? "submitted"),
      updatedAt: String((b as { updated_at: string }).updated_at ?? ""),
    });
  }

  const items = await Promise.all((invitations ?? []).map(async (row) => {
    const r = row as unknown as {
      partner_id: string;
      invited_at: string;
      last_invited_at: string;
      last_channel: string | null;
      partners:
        | { id: string; contact_name?: string | null; company_name?: string | null; email?: string | null }
        | { id: string; contact_name?: string | null; company_name?: string | null; email?: string | null }[]
        | null;
    };
    const partner = Array.isArray(r.partners) ? r.partners[0] : r.partners;
    const name =
      partner?.company_name?.trim() ||
      partner?.contact_name?.trim() ||
      "Unknown partner";
    const token = createPartnerBidToken(quote.id, r.partner_id);
    const targetPath = `/quote/respond?token=${encodeURIComponent(token)}`;
    const { shortPath } = await upsertShortLink({
      targetPath,
      kind: "partner_bid",
      entityRef: `quote:${quote.id}:partner:${r.partner_id}`,
      createdBy: auth.user.id,
    });
    const bidUrl = `${base}${shortPath}`;
    const bid = bidsByPartner.get(r.partner_id) ?? null;
    return {
      partnerId:     r.partner_id,
      partnerName:   name,
      partnerEmail:  partner?.email ?? null,
      invitedAt:     r.invited_at,
      lastInvitedAt: r.last_invited_at,
      lastChannel:   r.last_channel,
      bidUrl,
      bidStatus:     bid?.status ?? null,
      bidAmount:     bid?.amount ?? null,
      bidUpdatedAt:  bid?.updatedAt ?? null,
    };
  }));

  return NextResponse.json({
    quoteId:         quote.id,
    quoteReference:  quote.reference,
    quoteStatus:     quote.status,
    invited:         items,
  });
}
