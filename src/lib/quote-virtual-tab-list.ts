import { isQuoteListNew, isQuoteReadyToSend } from "@/lib/quote-list-buckets";
import type { ListResult } from "@/services/base";
import type { Quote } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export type QuoteVirtualTab = "new" | "ready_to_send";

const DRAFT_CHUNK_SIZE = 1000;

/** Fallback select — list columns without scanning wide JSON blobs. */
const DRAFT_LIST_SELECT =
  "id,reference,title,client_id,client_name,client_email,property_id,source_account_id,status,quote_type,draft_route_completed,customer_pdf_sent_at,total_value,deposit_required,margin_percent,service_type,created_at,updated_at,bidding_started_at,external_source,external_ref";

const VIRTUAL_TAB_SEARCH_COLUMNS = ["reference", "title", "client_name", "client_email"] as const;

export interface FetchVirtualTabQuotesOptions {
  page?: number;
  pageSize?: number;
  search?: string;
}

export function matchesQuoteVirtualTab(q: Quote, tab: QuoteVirtualTab): boolean {
  return tab === "new" ? isQuoteListNew(q) : isQuoteReadyToSend(q);
}

export function quoteMatchesVirtualTabSearch(
  q: Quote,
  search: string | undefined,
): boolean {
  const needle = search?.trim().toLowerCase();
  if (!needle) return true;
  for (const col of VIRTUAL_TAB_SEARCH_COLUMNS) {
    const raw = q[col];
    if (raw != null && String(raw).toLowerCase().includes(needle)) return true;
  }
  return false;
}

/** Filter, search, and sort drafts for a virtual funnel tab (same logic as tab badges). */
export function filterQuotesForVirtualTab(
  rows: Quote[],
  tab: QuoteVirtualTab,
  search?: string,
): Quote[] {
  return rows
    .filter((q) => matchesQuoteVirtualTab(q, tab))
    .filter((q) => quoteMatchesVirtualTabSearch(q, search))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function paginateQuoteRows(
  rows: Quote[],
  page: number,
  pageSize: number,
): ListResult<Quote> {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    data: rows.slice(start, start + pageSize),
    count: total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

/** Load all non-deleted drafts, then filter/paginate with `isQuoteListNew` / `isQuoteReadyToSend`. */
export async function fetchVirtualTabQuotes(
  supabase: SupabaseClient,
  tab: QuoteVirtualTab,
  opts: FetchVirtualTabQuotesOptions = {},
): Promise<ListResult<Quote>> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 10;
  const rows: Quote[] = [];

  for (let offset = 0; ; offset += DRAFT_CHUNK_SIZE) {
    const { data, error } = await supabase
      .from("quotes")
      .select(DRAFT_LIST_SELECT)
      .eq("status", "draft")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + DRAFT_CHUNK_SIZE - 1);

    if (error) throw error;
    const chunk = (data ?? []) as unknown as Quote[];
    rows.push(...chunk);
    if (chunk.length < DRAFT_CHUNK_SIZE) break;
  }

  const filtered = filterQuotesForVirtualTab(rows, tab, opts.search);
  return paginateQuoteRows(filtered, page, pageSize);
}
