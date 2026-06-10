import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolvePartnerJoinInvite } from "@/lib/partner-join-invite";

export const dynamic = "force-dynamic";

/** GET /api/join/invite?code= — prefill Trade Portal /join for an invited directory partner. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")?.trim();
  if (!code) {
    return NextResponse.json({ error: "missing_code" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const invite = await resolvePartnerJoinInvite(supabase, code);
  if (!invite) {
    return NextResponse.json({ error: "invalid_or_expired" }, { status: 401 });
  }

  return NextResponse.json({
    partnerId: invite.partnerId,
    expiresAt: invite.expiresAt,
    email: invite.email,
    fullName: invite.contactName,
    companyName: invite.companyName,
    phone: invite.phone,
    address: invite.partnerAddress,
    trades: invite.trades,
    utr: invite.utr,
  });
}
