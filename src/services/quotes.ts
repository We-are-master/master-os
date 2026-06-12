import { getSupabase, queryList, type ListParams, type ListResult } from "./base";
import type { Quote, QuoteLineItem } from "@/types/database";
import { bucketDraftQuoteRows, type QuoteFunnelTabCounts } from "@/lib/quote-list-buckets";
import { rpcGetQuoteFunnelBundle } from "@/lib/quote-funnel-rpc";
import { fetchVirtualTabQuotes } from "@/lib/quote-virtual-tab-list";
import {
  isSupabaseMissingColumnError,
  parsePostgrestUnknownColumnName,
  postgrestFullErrorText,
} from "@/lib/supabase-schema-compat";
import { batchResolveClientAccountLogoUrls, batchResolveLinkedAccountLabels } from "@/lib/client-linked-account-label";

/** Real `quotes` columns only — stray keys (e.g. from UI state spread) must not reach PostgREST. */
const QUOTE_WRITABLE_KEYS = new Set<string>([
  "title",
  "request_id",
  "catalog_service_id",
  "client_id",
  "client_address_id",
  "client_name",
  "client_email",
  "source_account_id",
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
  "draft_route_completed",
  "deposit_percent",
  "deposit_required",
  "start_date_option_1",
  "start_date_option_2",
  "customer_accepted",
  "customer_deposit_paid",
  "scope",
  "email_custom_message",
  "customer_pdf_sent_at",
  "bidding_started_at",
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
  "property_id",
  "duration_value",
  "duration_unit",
  "engagement_kind",
  "external_source",
  "external_ref",
]);

function pickQuotePayload(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined && QUOTE_WRITABLE_KEYS.has(k)) out[k] = v;
  }
  return out;
}

const LEGACY_OPTIONAL_QUOTE_KEYS = ["deposit_percent", "deposit_required"] as const;

/** Newer `quotes` columns: strip on PGRST204 when the error body omits the column name (e.g. Kong edge). */
const OPTIONAL_NEW_QUOTE_WRITE_KEYS = ["source_account_id"] as const;

/**
 * Returns a new payload with one unknown column removed, or strips legacy deposit fields when
 * PostgREST still errors (e.g. message references `quotes` but parser missed the column name).
 */
function isQuoteOwnerFkViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  const msg = (e.message ?? "").toLowerCase();
  return (
    e.code === "23503" &&
    (msg.includes("quotes_owner_id_fkey") || (msg.includes("owner_id") && msg.includes("profiles")))
  );
}

function tryRelaxQuoteWritePayload(
  payload: Record<string, unknown>,
  error: unknown,
  ref: string | null,
): Record<string, unknown> | null {
  const col = parsePostgrestUnknownColumnName(error);
  if (col && col in payload && col !== "reference") {
    const { [col]: _, ...rest } = payload;
    const next = { ...rest } as Record<string, unknown>;
    if (ref != null) next.reference = ref;
    return next;
  }
  if (isSupabaseMissingColumnError(error)) {
    for (const k of OPTIONAL_NEW_QUOTE_WRITE_KEYS) {
      if (k in payload) {
        const { [k]: _, ...rest } = payload;
        const next = { ...rest } as Record<string, unknown>;
        if (ref != null) next.reference = ref;
        return next;
      }
    }
  }
  const txt = postgrestFullErrorText(error);
  if (!txt.includes("quotes") && !txt.includes("'quotes'")) return null;
  const next = { ...payload } as Record<string, unknown>;
  let changed = false;
  for (const k of LEGACY_OPTIONAL_QUOTE_KEYS) {
    if (k in next) {
      delete next[k];
      changed = true;
    }
  }
  if (!changed) return null;
  if (ref != null) next.reference = ref;
  return next;
}

async function enrichQuotesWithAccountNames(quotes: Quote[]): Promise<Quote[]> {
  const clientIds = [...new Set(quotes.map((q) => q.client_id).filter(Boolean))] as string[];
  if (clientIds.length === 0) return quotes;
  const supabase = getSupabase();
  const [labels, logos] = await Promise.all([
    batchResolveLinkedAccountLabels(supabase, clientIds),
    batchResolveClientAccountLogoUrls(supabase, clientIds),
  ]);
  return quotes.map((q) => ({
    ...q,
    source_account_name: q.client_id ? labels.get(q.client_id) ?? null : null,
    source_account_logo_url: q.client_id ? logos.get(q.client_id) ?? null : null,
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

  /** Virtual funnel tabs — fast RPC (same SQL logic as tab badges). */
  if (params.quotesNewTab || params.quotesReadyToSendTab) {
    const tab = params.quotesNewTab ? "new" : "ready_to_send";
    const virtualOpts = { page, pageSize, search: params.search };

    async function loadVirtualTab() {
      const result = await fetchVirtualTabQuotes(supabase, tab, virtualOpts);
      const enriched = await enrichQuotesWithAccountNames(result.data);
      return { ...result, data: enriched };
    }

    try {
      const result = await rpcGetQuoteFunnelBundle(supabase, tab, virtualOpts);
      if ((result.data?.length ?? 0) > 0 || (result.count ?? 0) === 0) {
        const enriched = await enrichQuotesWithAccountNames(result.data);
        return { ...result, data: enriched };
      }
      console.warn(
        `[quotes] get_quote_funnel_bundle returned 0 rows for tab=${tab} (total=${result.count}); using client fallback`,
      );
      return await loadVirtualTab();
    } catch (rpcErr) {
      console.warn(
        "[quotes] get_quote_funnel_bundle unavailable, using client fallback:",
        rpcErr instanceof Error ? rpcErr.message : rpcErr,
      );
      return await loadVirtualTab();
    }
  }

  /** `get_quotes_list_bundle` only accepts one status — use PostgREST for `statusIn`. */
  if (params.statusIn && params.statusIn.length > 0) {
    const result = await queryList<Quote>("quotes", params, {
      searchColumns: ["reference", "title", "client_name", "client_email"],
      defaultSort: "created_at",
    });
    const enriched = await enrichQuotesWithAccountNames(result.data);
    return { ...result, data: enriched };
  }

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

/** Counts for virtual **New** / **Ready to send** tabs (subset of `status = draft`). */
export async function loadQuoteFunnelTabCounts(): Promise<QuoteFunnelTabCounts> {
  const supabase = getSupabase();
  const pageSize = 1000;
  const rows: Pick<
    Quote,
    "status" | "draft_route_completed" | "quote_type" | "customer_pdf_sent_at" | "total_value"
  >[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("quotes")
      .select("status,draft_route_completed,quote_type,customer_pdf_sent_at,total_value")
      .eq("status", "draft")
      .is("deleted_at", null)
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const chunk = (data ?? []) as typeof rows;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return bucketDraftQuoteRows(rows);
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
  const { data: ref, error: refErr } = await supabase.rpc("next_quote_ref");
  if (refErr) throw refErr;
  const row = pickQuotePayload({ ...input } as Record<string, unknown>);
  let insertPayload: Record<string, unknown> = { ...row, reference: ref };

  for (let attempt = 0; attempt < 32; attempt++) {
    const { data, error } = await supabase.from("quotes").insert(insertPayload).select("id").single();
    if (!error && data?.id) {
      const full = await getQuote(String(data.id));
      if (!full) throw new Error("Quote was created but could not be loaded");
      return full;
    }
    if (!error) throw new Error("Quote insert returned no id");

    if (isSupabaseMissingColumnError(error)) {
      const relaxed = tryRelaxQuoteWritePayload(insertPayload, error, String(ref));
      if (relaxed) {
        insertPayload = relaxed;
        continue;
      }
    }
    if (isQuoteOwnerFkViolation(error)) {
      const next = { ...insertPayload };
      delete next.owner_id;
      delete next.owner_name;
      insertPayload = next;
      continue;
    }
    throw error;
  }
  throw new Error("Quote insert exhausted schema retries");
}

export async function updateQuote(
  id: string,
  input: Partial<Quote>
): Promise<Quote> {
  const supabase = getSupabase();
  const row = pickQuotePayload({ ...input } as Record<string, unknown>);
  let payload: Record<string, unknown> = { ...row, updated_at: new Date().toISOString() };

  for (let attempt = 0; attempt < 32; attempt++) {
    const { error } = await supabase.from("quotes").update(payload).eq("id", id);
    if (!error) {
      const full = await getQuote(id);
      if (!full) throw new Error("Quote not found after update");
      return full;
    }

    if (isSupabaseMissingColumnError(error)) {
      const relaxed = tryRelaxQuoteWritePayload(payload, error, null);
      if (relaxed) {
        payload = { ...relaxed, updated_at: new Date().toISOString() };
        continue;
      }
    }
    throw new Error(postgrestFullErrorText(error) || "Quote update failed");
  }
  throw new Error("Quote update exhausted schema retries");
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
