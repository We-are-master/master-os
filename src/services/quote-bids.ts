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
  /** Joined from `partners` — drives the "best value" auto-select strategy. */
  partner_rating?: number | null;
  partner_jobs_completed?: number | null;
}

/**
 * Mean `bid_amount` per quote for bids still in play (`submitted`).
 * Used on list views; pair with Realtime on `quote_bids` for live updates.
 */
export async function getSubmittedBidAveragesByQuoteIds(
  quoteIds: string[],
): Promise<Record<string, number>> {
  const ids = quoteIds.filter(Boolean);
  if (ids.length === 0) return {};
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("quote_bids")
    .select("quote_id, bid_amount")
    .in("quote_id", ids)
    .eq("status", "submitted");
  if (error) throw error;
  const sums = new Map<string, { sum: number; n: number }>();
  for (const row of data ?? []) {
    const rec = row as { quote_id: string; bid_amount: number };
    const qid = String(rec.quote_id);
    const amt = Number(rec.bid_amount) || 0;
    const cur = sums.get(qid) ?? { sum: 0, n: 0 };
    cur.sum += amt;
    cur.n += 1;
    sums.set(qid, cur);
  }
  const out: Record<string, number> = {};
  for (const [qid, { sum, n }] of sums) {
    if (n > 0) out[qid] = sum / n;
  }
  return out;
}

export async function getBidsByQuoteId(quoteId: string): Promise<QuoteBid[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("quote_bids")
    .select("*, partners ( rating, jobs_completed )")
    .eq("quote_id", quoteId)
    .order("bid_amount", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => {
    const partnerRel = row.partners as { rating?: number | null; jobs_completed?: number | null } | { rating?: number | null; jobs_completed?: number | null }[] | null | undefined;
    const partner = Array.isArray(partnerRel) ? partnerRel[0] : partnerRel;
    return {
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
      partner_rating: partner?.rating != null ? Number(partner.rating) : null,
      partner_jobs_completed: partner?.jobs_completed != null ? Number(partner.jobs_completed) : null,
    };
  }) as QuoteBid[];
}

/** Internal selection for customer proposal — does not approve bids or notify partners. */
export async function selectBidForProposal(bidId: string, quoteId: string): Promise<void> {
  const res = await fetch("/api/quotes/select-bid-for-proposal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bidId, quoteId }),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(json.error ?? `Failed to select bid (${res.status})`);
  }
}
