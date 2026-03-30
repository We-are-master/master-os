import { getSupabase, queryList, type ListParams, type ListResult } from "./base";
import type { Partner } from "@/types/database";

export interface PartnerListParams extends ListParams {
  trade?: string;
}

export async function listPartners(params: PartnerListParams): Promise<ListResult<Partner>> {
  const supabase = getSupabase();
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 10;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase.from("partners").select("*", { count: "exact" });

  if (params.status && params.status !== "all") {
    query = query.eq("status", params.status);
  }
  if (params.trade && params.trade !== "all") {
    // Match against either legacy `trade` or `trades` array (when available).
    query = query.or(`trade.eq.${params.trade},trades.cs.{${params.trade}}`);
  }
  if (params.search) {
    query = query.or(
      `company_name.ilike.%${params.search}%,contact_name.ilike.%${params.search}%,email.ilike.%${params.search}%`
    );
  }

  query = query.order(params.sortBy ?? "joined_at", { ascending: false });
  query = query.range(from, to);

  let { data, error, count } = await query;
  if (error && params.trade && params.trade !== "all") {
    // Fallback for environments where `trades` column is not available yet.
    let fallback = supabase.from("partners").select("*", { count: "exact" });
    if (params.status && params.status !== "all") fallback = fallback.eq("status", params.status);
    fallback = fallback.eq("trade", params.trade);
    if (params.search) {
      fallback = fallback.or(
        `company_name.ilike.%${params.search}%,contact_name.ilike.%${params.search}%,email.ilike.%${params.search}%`
      );
    }
    fallback = fallback.order(params.sortBy ?? "joined_at", { ascending: false }).range(from, to);
    const fallbackRes = await fallback;
    data = fallbackRes.data;
    error = fallbackRes.error;
    count = fallbackRes.count;
  }
  if (error) throw error;

  return {
    data: (data ?? []) as Partner[],
    count: count ?? 0,
    page,
    pageSize,
    totalPages: Math.ceil((count ?? 0) / pageSize),
  };
}

export async function createPartner(
  input: Omit<Partner, "id" | "joined_at" | "rating" | "jobs_completed" | "total_earnings" | "compliance_score">
): Promise<Partner> {
  const supabase = getSupabase();
  let { data, error } = await supabase
    .from("partners")
    .insert(input)
    .select()
    .single();
  if (error && "trades" in input) {
    const { trades: _ignored, ...legacyInput } = input as Omit<Partner, "trades"> & { trades?: string[] | null };
    const fallback = await supabase.from("partners").insert(legacyInput).select().single();
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;
  return data as Partner;
}

export async function updatePartner(id: string, input: Partial<Partner>): Promise<Partner> {
  const supabase = getSupabase();
  let { data, error } = await supabase
    .from("partners")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error && "trades" in input) {
    const { trades: _ignored, ...legacyInput } = input as Partial<Partner> & { trades?: string[] | null };
    const fallback = await supabase
      .from("partners")
      .update(legacyInput)
      .eq("id", id)
      .select()
      .single();
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;
  return data as Partner;
}
