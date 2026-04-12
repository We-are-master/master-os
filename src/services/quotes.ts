import { getSupabase, queryList, type ListParams, type ListResult } from "./base";
import type { Quote, QuoteLineItem } from "@/types/database";
import { isSupabaseMissingColumnError, parsePostgrestUnknownColumnName } from "@/lib/supabase-schema-compat";
import { batchResolveLinkedAccountLabels } from "@/lib/client-linked-account-label";

/** Real `quotes` columns only — stray keys (e.g. from UI state spread) must not reach PostgREST. */
const QUOTE_WRITABLE_KEYS = new Set<string>([
  "title",
  "request_id",
  "catalog_service_id",
  "client_id",
  "client_address_id",
  "client_name",
  "client_email",
  "status",
  "total_value",
  "ai_confidence",
  "partner_quotes_count",
  "automation_status",
  "owner_id",
  "owner_name",
  "cost",
  "sell_price",
  "margin_percent",
  "quote_type",
  "deposit_percent",
  "deposit_required",
  "start_date_option_1",
  "start_date_option_2",
  "customer_accepted",
  "customer_deposit_paid",
  "scope",
  "email_custom_message",
  "customer_pdf_sent_at",
  "property_address",
  "partner_id",
  "partner_name",
  "partner_cost",
  "service_type",
  "images",
  "expires_at",
  "rejection_reason",
  "priority",
  "postcode",
  "client_phone",
  "description",
  "deleted_at",
  "deleted_by",
]);

function pickQuotePayload(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined && QUOTE_WRITABLE_KEYS.has(k)) out[k] = v;
  }
  return out;
}

async function enrichQuotesWithAccountNames(quotes: Quote[]): Promise<Quote[]> {
  const clientIds = [...new Set(quotes.map((q) => q.client_id).filter(Boolean))] as string[];
  if (clientIds.length === 0) return quotes;
  const labels = await batchResolveLinkedAccountLabels(getSupabase(), clientIds);
  return quotes.map((q) => ({
    ...q,
    source_account_name: q.client_id ? labels.get(q.client_id) ?? null : null,
  }));
}

/**
 * Quotes list — fast path uses `get_quotes_list_bundle` RPC (migration 125),
 * which returns paged rows + per-quote line item counts/totals in a single
 * round-trip. Falls back to the legacy `queryList` path on RPC failure so
 * older databases still work.
 */
export async function listQuotes(params: ListParams): Promise<ListResult<Quote>> {
  const supabase = getSupabase();
  const page     = params.page ?? 1;
  const pageSize = params.pageSize ?? 10;

  const statusArg = params.status && params.status !== "all" ? params.status : null;
  const searchArg = params.search?.trim() || null;

  const { data, error } = await supabase.rpc("get_quotes_list_bundle", {
    p_status: statusArg,
    p_search: searchArg,
    p_limit:  pageSize,
    p_offset: (page - 1) * pageSize,
  });

  if (!error && data) {
    const payload = data as { rows: Quote[]; total: number };
    const total   = payload.total ?? 0;
    const enriched = await enrichQuotesWithAccountNames(payload.rows ?? []);
    return {
      data:       enriched,
      count:      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  // Legacy fallback
  const result = await queryList<Quote>("quotes", params, {
    searchColumns: ["reference", "title", "client_name", "client_email"],
    defaultSort: "created_at",
  });
  const enriched = await enrichQuotesWithAccountNames(result.data);
  return { ...result, data: enriched };
}

export async function getQuote(id: string): Promise<Quote | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data as Quote;
}

export async function createQuote(
  input: Omit<Quote, "id" | "reference" | "created_at" | "updated_at">
): Promise<Quote> {
  const supabase = getSupabase();
  const { data: ref } = await supabase.rpc("next_quote_ref");
  const row = pickQuotePayload({ ...input } as Record<string, unknown>);
  let insertPayload: Record<string, unknown> = { ...row, reference: ref };
  let { data, error } = await supabase.from("quotes").insert(insertPayload).select().single();
  for (let attempt = 0; attempt < 24 && error; attempt++) {
    const col = parsePostgrestUnknownColumnName(error);
    if (isSupabaseMissingColumnError(error) && col && col in insertPayload && col !== "reference") {
      const { [col]: _, ...rest } = insertPayload;
      insertPayload = { ...rest, reference: ref };
      const retry = await supabase.from("quotes").insert(insertPayload).select().single();
      data = retry.data;
      error = retry.error;
      continue;
    }
    break;
  }
  if (error) throw error;
  return data as Quote;
}

export async function updateQuote(
  id: string,
  input: Partial<Quote>
): Promise<Quote> {
  const supabase = getSupabase();
  const row = pickQuotePayload({ ...input } as Record<string, unknown>);
  let payload: Record<string, unknown> = { ...row, updated_at: new Date().toISOString() };
  let { data, error } = await supabase.from("quotes").update(payload).eq("id", id).select().single();
  for (let attempt = 0; attempt < 24 && error; attempt++) {
    const col = parsePostgrestUnknownColumnName(error);
    if (isSupabaseMissingColumnError(error) && col && col in payload) {
      const { [col]: _, ...rest } = payload;
      payload = { ...rest, updated_at: new Date().toISOString() };
      const retry = await supabase.from("quotes").update(payload).eq("id", id).select().single();
      data = retry.data;
      error = retry.error;
      continue;
    }
    break;
  }
  if (error) throw new Error(error.message);
  return data as Quote;
}

export async function listQuoteLineItems(quoteId: string): Promise<QuoteLineItem[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("quote_line_items")
    .select("*")
    .eq("quote_id", quoteId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as QuoteLineItem[];
}
