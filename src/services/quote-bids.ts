import { getSupabase } from "./base";

export interface QuoteBid {
  id: string;
  quote_id: string;
  partner_id: string;
  partner_name?: string;
  bid_amount: number;
  job_type?: "fixed" | "hourly";
  notes?: string;
  status: "submitted" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
}

export async function getBidsByQuoteId(quoteId: string): Promise<QuoteBid[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("quote_bids")
    .select("*")
    .eq("quote_id", quoteId)
    .order("bid_amount", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    quote_id: String(row.quote_id),
    partner_id: String(row.partner_id),
    partner_name: row.partner_name as string | undefined,
    bid_amount: Number(row.bid_amount),
    job_type: (row.job_type as "fixed" | "hourly" | undefined) ?? "fixed",
    notes: row.notes as string | undefined,
    status: row.status as QuoteBid["status"],
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  })) as QuoteBid[];
}

export async function approveBid(
  bidId: string,
  quoteId: string,
  _partnerId: string,
  _partnerName: string | undefined,
  _bidAmount: number
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc("approve_quote_bid", {
    p_bid_id: bidId,
    p_quote_id: quoteId,
  });
  if (error) throw error;
}
