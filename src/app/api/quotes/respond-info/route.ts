import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  verifyPartnerBidToken,
  verifyPartnerReportToken,
  verifyQuoteResponseToken,
} from "@/lib/quote-response-token";

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SERVICE_ROLE_KEY!,
  );
}

const fmtDate = (d: string | null | undefined) => {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return d;
  }
};

/**
 * GET /api/quotes/respond-info?token=...
 * Public: quote summary for the customer Accept/Reject page (token must match).
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  // Three token formats land on the same endpoint:
  //   - customer quote link  → carries quoteId only
  //   - partner bid link     → carries quoteId + partnerId, kind="bid"
  //   - partner report link  → carries quoteId + partnerId, kind="report"
  // We surface `tokenKind` so the page can pick the right UI.
  let quoteId: string | null = null;
  let tokenPartnerId: string | null = null;
  let tokenKind: "customer" | "partner_bid" | "partner_report" = "customer";

  const bidMatch = verifyPartnerBidToken(token);
  if (bidMatch) {
    quoteId = bidMatch.quoteId;
    tokenPartnerId = bidMatch.partnerId;
    tokenKind = "partner_bid";
  } else {
    const reportMatch = verifyPartnerReportToken(token);
    if (reportMatch) {
      quoteId = reportMatch.quoteId;
      tokenPartnerId = reportMatch.partnerId;
      tokenKind = "partner_report";
    } else {
      quoteId = verifyQuoteResponseToken(token);
    }
  }
  if (!quoteId) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select(
      "id, reference, title, client_name, property_address, scope, total_value, deposit_required, start_date_option_1, start_date_option_2, status, service_type",
    )
    .eq("id", quoteId)
    .single();

  if (quoteError || !quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  // When the quote was already converted to a job, surface the linked job's
  // identity + report submission state so the public page can switch from
  // accept/reject UI to the report submission form.
  let linkedJob: {
    id: string;
    reference: string;
    serviceType: string | null;
    status: string;
    title: string | null;
    propertyAddress: string | null;
    startReportSubmitted: boolean;
    finalReportSubmitted: boolean;
  } | null = null;

  // Bid context: when this is a partner-bid token AND the quote is still in
  // bidding state, surface the partner display name + any existing bid the
  // partner has already submitted (so the form preloads / shows "you've
  // already bid X, update?").
  let bidContext:
    | { partnerName: string | null; existingBid: { amount: number; jobType: "fixed" | "hourly"; notes: string | null } | null }
    | null = null;

  if (tokenKind === "partner_bid" && tokenPartnerId && quote.status === "bidding") {
    const { data: partner } = await supabase
      .from("partners")
      .select("contact_name, company_name")
      .eq("id", tokenPartnerId)
      .maybeSingle();
    const partnerName =
      (partner?.company_name?.trim() || partner?.contact_name?.trim()) ?? null;
    const { data: existing } = await supabase
      .from("quote_bids")
      .select("bid_amount, job_type, notes")
      .eq("quote_id", quote.id)
      .eq("partner_id", tokenPartnerId)
      .maybeSingle();
    bidContext = {
      partnerName,
      existingBid: existing
        ? {
            amount:  Number(existing.bid_amount) || 0,
            jobType: (existing.job_type as "fixed" | "hourly") ?? "fixed",
            notes:   (existing.notes as string | null) ?? null,
          }
        : null,
    };
  }

  if (quote.status === "converted_to_job") {
    const { data: jobRow } = await supabase
      .from("jobs")
      .select("id, reference, service_type, status, title, property_address, partner_id, start_report_submitted, final_report_submitted")
      .eq("quote_id", quote.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (jobRow) {
      // Only expose linkedJob to partner-report tokens whose partnerId matches
      // the current job partner. Customer-token holders never see the report form.
      const tokenMatchesAssignedPartner =
        tokenKind === "partner_report" &&
        !!jobRow.partner_id &&
        jobRow.partner_id === tokenPartnerId;
      if (tokenMatchesAssignedPartner) {
        linkedJob = {
          id:                    jobRow.id,
          reference:             jobRow.reference,
          serviceType:           jobRow.service_type ?? quote.service_type ?? null,
          status:                jobRow.status,
          title:                 jobRow.title ?? null,
          propertyAddress:       jobRow.property_address ?? null,
          startReportSubmitted:  !!jobRow.start_report_submitted,
          finalReportSubmitted:  !!jobRow.final_report_submitted,
        };
      }
    }
  }

  const { data: rows } = await supabase
    .from("quote_line_items")
    .select("description, quantity, unit_price, total")
    .eq("quote_id", quoteId)
    .order("sort_order");

  const lineItems = (rows ?? []).map(
    (r: { description: string; quantity: number; unit_price: number; total: number }) => ({
      description: r.description,
      quantity: Number(r.quantity) || 1,
      unitPrice: Number(r.unit_price) || 0,
      total: Number(r.total) || (Number(r.quantity) || 1) * (Number(r.unit_price) || 0),
    }),
  );

  return NextResponse.json({
    reference: quote.reference,
    title: quote.title,
    clientName: quote.client_name,
    propertyAddress: quote.property_address ?? null,
    scope: quote.scope ?? null,
    serviceType: quote.service_type ?? null,
    totalValue: Number(quote.total_value) || 0,
    depositRequired: Number(quote.deposit_required) || 0,
    startDateOption1: fmtDate(quote.start_date_option_1 ?? undefined),
    startDateOption2: fmtDate(quote.start_date_option_2 ?? undefined),
    status: quote.status,
    lineItems,
    tokenKind,
    linkedJob,
    bidContext,
  });
}
