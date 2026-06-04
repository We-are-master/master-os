import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Internal staff selection: sync chosen partner onto the quote for customer proposal / job
 * conversion. Does not change quote_bids.status or notify the partner.
 */
export async function selectQuoteBidForProposal(
  supabase: SupabaseClient,
  bidId: string,
  quoteId: string,
): Promise<{ partner_id: string; partner_name: string | null; partner_cost: number }> {
  const { data: bid, error: bidErr } = await supabase
    .from("quote_bids")
    .select("id, partner_id, partner_name, bid_amount, status")
    .eq("id", bidId)
    .eq("quote_id", quoteId)
    .maybeSingle();

  if (bidErr) throw bidErr;
  if (!bid) throw new Error("Bid not found for this quote");
  if (bid.status !== "submitted") {
    throw new Error("Only submitted bids can be selected for the customer proposal");
  }

  const now = new Date().toISOString();
  const { error: quoteErr } = await supabase
    .from("quotes")
    .update({
      partner_id: bid.partner_id,
      partner_name: bid.partner_name,
      partner_cost: bid.bid_amount,
      updated_at: now,
    })
    .eq("id", quoteId);
  if (quoteErr) throw quoteErr;

  return {
    partner_id: String(bid.partner_id),
    partner_name: (bid.partner_name as string | null) ?? null,
    partner_cost: Number(bid.bid_amount) || 0,
  };
}
