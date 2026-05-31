import type { SupabaseClient } from "@supabase/supabase-js";
import type { BiddingSlaAnchorQuote } from "@/lib/quote-bidding-sla";

let biddingStartedAtColumnExists: boolean | null = null;

async function probeBiddingStartedAtColumn(supabase: SupabaseClient): Promise<boolean> {
  if (biddingStartedAtColumnExists != null) return biddingStartedAtColumnExists;
  const { error } = await supabase
    .from("quotes")
    .select("bidding_started_at")
    .limit(1);
  biddingStartedAtColumnExists = !error;
  return biddingStartedAtColumnExists;
}

/** Fetch open bidding quotes for SLA rollups, with or without `bidding_started_at`. */
export async function fetchBiddingSlaAnchorQuotes(
  supabase: SupabaseClient,
): Promise<BiddingSlaAnchorQuote[]> {
  if (await probeBiddingStartedAtColumn(supabase)) {
    const { data, error } = await supabase
      .from("quotes")
      .select("bidding_started_at, updated_at, created_at, status")
      .in("status", ["bidding", "in_survey"])
      .is("deleted_at", null);
    if (error) throw error;
    return (data ?? []) as BiddingSlaAnchorQuote[];
  }

  const { data, error } = await supabase
    .from("quotes")
    .select("updated_at, created_at, status")
    .in("status", ["bidding", "in_survey"])
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? []) as BiddingSlaAnchorQuote[];
}
