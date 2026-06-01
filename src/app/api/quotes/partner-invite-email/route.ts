import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { sendQuotePartnerInviteEmails } from "@/lib/quote-partner-invite-email";

/** Email selected partners when inviting to bid (includes site photo links from the linked request). */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const quoteId = typeof body.quoteId === "string" ? body.quoteId.trim() : "";
    const partnerIds = Array.isArray(body.partnerIds)
      ? (body.partnerIds as unknown[]).filter((x): x is string => typeof x === "string" && isValidUUID(x.trim()))
      : [];
    if (!quoteId || !isValidUUID(quoteId)) {
      return NextResponse.json({ error: "quoteId is required" }, { status: 400 });
    }
    if (partnerIds.length === 0) {
      return NextResponse.json({ ok: true, sent: 0 });
    }

    const supabase = createServiceClient();
    const { data: quote, error: qErr } = await supabase
      .from("quotes")
      .select("id")
      .eq("id", quoteId)
      .single();
    if (qErr || !quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    const { sent, invited } = await sendQuotePartnerInviteEmails(supabase, {
      quoteId,
      partnerIds,
      invitedBy: auth.user.id,
    });

    return NextResponse.json({ ok: true, sent, invited });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
