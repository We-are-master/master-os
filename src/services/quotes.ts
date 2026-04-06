import { getSupabase, queryList, type ListParams, type ListResult } from "./base";
import type { Quote, QuoteLineItem } from "@/types/database";
import { isSupabaseMissingColumnError } from "@/lib/supabase-schema-compat";

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

export async function listQuotes(params: ListParams): Promise<ListResult<Quote>> {
  return queryList<Quote>("quotes", params, {
    searchColumns: ["reference", "title", "client_name", "client_email"],
    defaultSort: "created_at",
  });
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
  let { data, error } = await supabase
    .from("quotes")
    .insert({ ...row, reference: ref })
    .select()
    .single();
  if (
    error &&
    isSupabaseMissingColumnError(error, "deposit_percent") &&
    "deposit_percent" in row
  ) {
    const { deposit_percent: _omit, ...rest } = row as Record<string, unknown>;
    const retry = await supabase
      .from("quotes")
      .insert({ ...rest, reference: ref })
      .select()
      .single();
    data = retry.data;
    error = retry.error;
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
  let payload = { ...row, updated_at: new Date().toISOString() };
  let { data, error } = await supabase
    .from("quotes")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (
    error &&
    isSupabaseMissingColumnError(error, "deposit_percent") &&
    "deposit_percent" in payload
  ) {
    const { deposit_percent: _omit, ...rest } = payload;
    payload = { ...rest, updated_at: new Date().toISOString() };
    const retry = await supabase
      .from("quotes")
      .update(payload)
      .eq("id", id)
      .select()
      .single();
    data = retry.data;
    error = retry.error;
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
