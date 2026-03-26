import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyQuoteResponseToken } from "@/lib/quote-response-token";

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

  const quoteId = verifyQuoteResponseToken(token);
  if (!quoteId) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select(
      "reference, title, client_name, property_address, scope, total_value, deposit_required, start_date_option_1, start_date_option_2, status",
    )
    .eq("id", quoteId)
    .single();

  if (quoteError || !quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
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
    totalValue: Number(quote.total_value) || 0,
    depositRequired: Number(quote.deposit_required) || 0,
    startDateOption1: fmtDate(quote.start_date_option_1 ?? undefined),
    startDateOption2: fmtDate(quote.start_date_option_2 ?? undefined),
    status: quote.status,
    lineItems,
  });
}
