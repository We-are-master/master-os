import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/requests/[id]/offers
 *
 * Lists the partners a service_request (lead) was distributed to, with each partner's
 * offer status (offered / viewed / contacted / declined…). Powers the "Distributed to"
 * view on the requests drawer.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: "Invalid request id" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("service_request_partner_offers")
    .select("id, partner_id, status, offered_at, contacted_at, partners(company_name, contact_name)")
    .eq("service_request_id", id)
    .order("offered_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const offers = (data ?? []).map((r) => {
    const p = (r as { partners?: { company_name?: string | null; contact_name?: string | null } | null }).partners;
    return {
      id: r.id as string,
      partnerId: r.partner_id as string,
      status: r.status as string,
      offeredAt: r.offered_at as string | null,
      contactedAt: r.contacted_at as string | null,
      partnerName: p?.company_name || p?.contact_name || "Partner",
    };
  });
  return NextResponse.json({ offers });
}
