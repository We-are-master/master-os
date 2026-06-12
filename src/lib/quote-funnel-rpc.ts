import type { QuoteFunnelTabCounts } from "@/lib/quote-list-buckets";
import type { ListResult } from "@/services/base";
import type { Quote } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export type QuoteFunnelRpcTab = "new" | "ready_to_send";

export type QuoteMetricsBundle = {
  status_counts: Record<string, number>;
  funnel_counts: QuoteFunnelTabCounts;
  total_sent_to_customer_value: number;
  awaiting_customer_value: number;
  converted_count: number;
  total_count: number;
  conversion_pct: number;
};

type FunnelBundlePayload = { rows: Quote[]; total: number };

export async function rpcGetQuoteFunnelBundle(
  supabase: SupabaseClient,
  tab: QuoteFunnelRpcTab,
  opts: { page?: number; pageSize?: number; search?: string } = {},
): Promise<ListResult<Quote>> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 10;
  const searchArg = opts.search?.trim() || null;

  const { data, error } = await supabase.rpc("get_quote_funnel_bundle", {
    p_tab: tab,
    p_search: searchArg,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });

  if (error) throw error;

  const payload = (data ?? { rows: [], total: 0 }) as FunnelBundlePayload;
  const total = payload.total ?? 0;
  return {
    data: payload.rows ?? [],
    count: total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function rpcGetQuoteMetricsBundle(
  supabase: SupabaseClient,
): Promise<QuoteMetricsBundle> {
  const { data, error } = await supabase.rpc("get_quote_metrics_bundle");
  if (error) throw error;

  const payload = (data ?? {}) as Partial<QuoteMetricsBundle> & {
    funnel_counts?: Partial<QuoteFunnelTabCounts>;
    status_counts?: Record<string, number>;
  };

  return {
    status_counts: payload.status_counts ?? {},
    funnel_counts: {
      draft: Number(payload.funnel_counts?.draft ?? 0),
      ready_to_send: Number(payload.funnel_counts?.ready_to_send ?? 0),
    },
    total_sent_to_customer_value: Number(payload.total_sent_to_customer_value ?? 0),
    awaiting_customer_value: Number(payload.awaiting_customer_value ?? 0),
    converted_count: Number(payload.converted_count ?? 0),
    total_count: Number(payload.total_count ?? 0),
    conversion_pct: Number(payload.conversion_pct ?? 0),
  };
}
