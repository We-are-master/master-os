/**
 * Server-side data loader for the Quotes page.
 *
 * The Quotes page defaults to the "pipeline" tab which expands to a
 * multi-status filter. The bundle RPC only supports a single status
 * argument, so for the pipeline tab we fall through to a direct
 * `.in("status", ...)` query (PostgREST).
 *
 * Single-status tabs (drafts, accepted, rejected, etc.) get the fast
 * RPC path.
 */
import { getServerSupabase } from "@/lib/supabase/server-cached";
import type { Quote } from "@/types/database";
import type { ListResult } from "@/services/base";

/** Mirrors `PIPELINE_STATUS_IN` in /quotes/page.tsx — keep in sync. */
const PIPELINE_STATUS = ["draft", "in_survey", "bidding", "awaiting_customer", "awaiting_payment"] as const;

interface FetchQuotesOptions {
  status?: string;
  pageSize?: number;
}

export async function fetchInitialQuotes(
  opts: FetchQuotesOptions = {},
): Promise<ListResult<Quote> | null> {
  const pageSize = opts.pageSize ?? 10;
  const status   = opts.status ?? "pipeline";

  try {
    const supabase = await getServerSupabase();

    // Pipeline tab → multi-status .in() (RPC doesn't support arrays yet)
    if (status === "pipeline") {
      const { data, count, error } = await supabase
        .from("quotes")
        .select("*", { count: "exact" })
        .is("deleted_at", null)
        .in("status", [...PIPELINE_STATUS])
        .order("created_at", { ascending: false })
        .range(0, pageSize - 1);

      if (error || !data) return null;
      const total = count ?? 0;
      return {
        data:       data as Quote[],
        count:      total,
        page:       1,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      };
    }

    // Single-status tab → fast bundle RPC
    const { data, error } = await supabase.rpc("get_quotes_list_bundle", {
      p_status: status === "all" ? null : status,
      p_search: null,
      p_limit:  pageSize,
      p_offset: 0,
    });

    if (error || !data) return null;
    const payload = data as { rows: Quote[]; total: number };
    const total   = payload.total ?? 0;
    return {
      data:       payload.rows ?? [],
      count:      total,
      page:       1,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  } catch {
    return null;
  }
}
