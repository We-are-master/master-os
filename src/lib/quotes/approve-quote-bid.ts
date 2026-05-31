import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Approve one quote bid and sync partner fields on the quote.
 * Mirrors `supabase/migrations/113_approve_quote_bid_rpc.sql` for environments
 * where the RPC has not been applied yet.
 */
export async function approveQuoteBidAdmin(
  supabase: SupabaseClient,
  bidId: string,
  quoteId: string,
): Promise<void> {
  const { data: bid, error: bidErr } = await supabase
    .from("quote_bids")
    .select("id, partner_id, partner_name, bid_amount")
    .eq("id", bidId)
    .eq("quote_id", quoteId)
    .maybeSingle();

  if (bidErr) throw bidErr;
  if (!bid) throw new Error("Bid not found for this quote");

  const now = new Date().toISOString();

  const { error: rejectErr } = await supabase
    .from("quote_bids")
    .update({ status: "rejected", updated_at: now })
    .eq("quote_id", quoteId)
    .neq("id", bidId);
  if (rejectErr) throw rejectErr;

  const { error: approveErr } = await supabase
    .from("quote_bids")
    .update({ status: "approved", updated_at: now })
    .eq("id", bidId);
  if (approveErr) throw approveErr;

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
}
