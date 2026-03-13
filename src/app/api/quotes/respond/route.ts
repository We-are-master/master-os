import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyQuoteResponseToken } from "@/lib/quote-response-token";

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SERVICE_ROLE_KEY!,
  );
}

/**
 * POST /api/quotes/respond
 * Public: customer accepts or rejects a quote via email link.
 * Body: { token: string, action: "accept" | "reject", rejectionReason?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, action, rejectionReason } = body as {
      token?: string;
      action?: string;
      rejectionReason?: string;
    };

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }
    if (action !== "accept" && action !== "reject") {
      return NextResponse.json({ error: "Action must be accept or reject" }, { status: 400 });
    }

    const quoteId = verifyQuoteResponseToken(token);
    if (!quoteId) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
    }

    const supabase = getServiceSupabase();
    const { data: quote, error: fetchError } = await supabase
      .from("quotes")
      .select("id, reference, status")
      .eq("id", quoteId)
      .single();

    if (fetchError || !quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    const updates: { status: string; rejection_reason?: string } = {
      status: action === "accept" ? "accepted" : "rejected",
    };
    if (action === "reject" && typeof rejectionReason === "string" && rejectionReason.trim()) {
      updates.rejection_reason = rejectionReason.trim();
    }

    const { error: updateError } = await supabase
      .from("quotes")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", quoteId);

    if (updateError) {
      console.error("Quote respond update error:", updateError);
      return NextResponse.json({ error: "Failed to update quote" }, { status: 500 });
    }

    await supabase.from("audit_logs").insert({
      entity_type: "quote",
      entity_id: quoteId,
      entity_ref: quote.reference,
      action: action === "accept" ? "status_changed" : "status_changed",
      field_name: "status",
      old_value: quote.status,
      new_value: updates.status,
      metadata: action === "reject" && updates.rejection_reason ? { rejection_reason: updates.rejection_reason } : {},
    });

    return NextResponse.json({
      success: true,
      action,
      reference: quote.reference,
      message: action === "accept" ? "Quote accepted. We will be in touch shortly." : "Quote declined. Thank you for letting us know.",
    });
  } catch (err) {
    console.error("Quote respond error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
