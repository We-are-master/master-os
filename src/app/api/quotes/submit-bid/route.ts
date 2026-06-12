import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPartnerBidToken } from "@/lib/quote-response-token";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  buildBidNotesJson,
  normalizePartnerBidPayloadInput,
  type PartnerBidProposalPayload,
  validatePartnerBidPayload,
} from "@/lib/quote-bid-payload";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SERVICE_ROLE_KEY!,
  );
}

/**
 * POST /api/quotes/submit-bid   (public, token-authenticated)
 *
 * Receives a bid from a partner via the partner-scoped bid link. The token
 * binds (quoteId, partnerId), so each invited partner has their own link
 * and bids are traceable per partner.
 *
 * Body: { token, bidAmount, jobType?: "fixed"|"hourly", payload: PartnerBidProposalPayload, notes? }
 *
 * Behaviour:
 *   - Quote must be in `bidding` status (else 409).
 *   - Structured payload is required (labour, materials, two start dates).
 *   - Upserts a single row in quote_bids on (quote_id, partner_id).
 *   - Rate-limited per IP.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`submit-bid:${ip}`, 20, 10 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let body: {
    token?: string;
    bidAmount?: number;
    jobType?: string;
    notes?: string;
    payload?: PartnerBidProposalPayload;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const token = (body.token ?? "").trim();
  if (!token) return NextResponse.json({ error: "Token is required." }, { status: 400 });
  const verified = verifyPartnerBidToken(token);
  if (!verified) {
    return NextResponse.json({ error: "Invalid or expired bid link." }, { status: 400 });
  }
  const { quoteId, partnerId } = verified;

  if (body.payload == null || typeof body.payload !== "object") {
    return NextResponse.json(
      { error: "Structured bid details are required (labour, materials, and start dates)." },
      { status: 400 },
    );
  }

  const bidAmount = Number(body.bidAmount);
  if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
    return NextResponse.json({ error: "Bid amount must be a positive number." }, { status: 400 });
  }

  const normalizedPayload = normalizePartnerBidPayloadInput(body.payload);
  const validation = validatePartnerBidPayload(normalizedPayload, bidAmount);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.errors.join(" "), errors: validation.errors }, { status: 400 });
  }

  const jobType: "fixed" | "hourly" =
    validation.payload.labour_pricing === "hourly" ? "hourly" : "fixed";
  const freeformNotes = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) : "";
  const notes = buildBidNotesJson(validation.payload, freeformNotes || null).slice(0, 4000);

  const supabase = getServiceSupabase();

  const { data: quote, error: quoteErr } = await supabase
    .from("quotes")
    .select("id, reference, status")
    .eq("id", quoteId)
    .is("deleted_at", null)
    .maybeSingle();
  if (quoteErr || !quote) {
    return NextResponse.json({ error: "Quote not found." }, { status: 404 });
  }
  if (quote.status !== "bidding") {
    return NextResponse.json(
      { error: "This quote is no longer accepting bids." },
      { status: 409 },
    );
  }

  const { data: partner } = await supabase
    .from("partners")
    .select("id, contact_name, company_name")
    .eq("id", partnerId)
    .maybeSingle();
  if (!partner) {
    return NextResponse.json({ error: "Partner not found." }, { status: 404 });
  }
  const partnerName =
    (partner.company_name?.trim() || partner.contact_name?.trim()) ?? null;

  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("quote_bids")
    .select("id")
    .eq("quote_id", quoteId)
    .eq("partner_id", partnerId)
    .maybeSingle();

  let bidId: string | null = null;
  if (existing?.id) {
    const { error: updErr } = await supabase
      .from("quote_bids")
      .update({
        bid_amount: bidAmount,
        job_type:   jobType,
        notes,
        status:     "submitted",
        updated_at: now,
      })
      .eq("id", existing.id);
    if (updErr) {
      console.error("[submit-bid] update failed:", updErr);
      return NextResponse.json({ error: "Could not save bid." }, { status: 500 });
    }
    bidId = existing.id;
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from("quote_bids")
      .insert({
        quote_id:    quoteId,
        partner_id:  partnerId,
        partner_name: partnerName,
        bid_amount:  bidAmount,
        job_type:    jobType,
        notes,
        status:      "submitted",
        created_at:  now,
        updated_at:  now,
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      console.error("[submit-bid] insert failed:", insErr);
      return NextResponse.json({ error: "Could not save bid." }, { status: 500 });
    }
    bidId = inserted.id;
  }

  void supabase.from("audit_logs").insert({
    entity_type: "quote",
    entity_id:   quoteId,
    entity_ref:  quote.reference,
    action:      "bid_submitted",
    field_name:  "quote_bids",
    new_value:   String(bidAmount),
    metadata:    { source: "public_partner_link", partner_id: partnerId, job_type: jobType, bid_id: bidId },
  }).then(({ error }) => { if (error) console.error("audit_logs (submit-bid)", error); });

  return NextResponse.json({ ok: true, bidId, quoteReference: quote.reference });
}
