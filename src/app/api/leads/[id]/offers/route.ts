import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/leads/[id]/offers
 *
 * Lists the partners who responded to a published lead from the Trade Portal. Each partner that
 * presses "Contact" in the portal inserts a lead_partner_offers row — its presence means the
 * partner reached out (the table has no status column). Powers the "Interested partners" panel
 * on the leads drawer.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: "Invalid lead id" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("lead_partner_offers")
    .select("id, partner_id, offered_at, partners(company_name, contact_name, phone, email)")
    .eq("lead_id", id)
    .order("offered_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const offers = (data ?? []).map((r) => {
    const p = (r as { partners?: { company_name?: string | null; contact_name?: string | null; phone?: string | null; email?: string | null } | null }).partners;
    return {
      id: r.id as string,
      partnerId: r.partner_id as string,
      partnerName: p?.company_name || p?.contact_name || "Partner",
      partnerPhone: p?.phone ?? null,
      partnerEmail: p?.email ?? null,
      contactedAt: r.offered_at as string | null,
    };
  });
  return NextResponse.json({ offers });
}
