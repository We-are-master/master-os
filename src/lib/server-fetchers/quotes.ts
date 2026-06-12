/**
 * Server-side data loader for the Quotes page.
 *
 * Multi-status filters use `.in("status", ...)` because `get_quotes_list_bundle`
 * only accepts a single `p_status`.
 *
 * "pipeline" (legacy Active tab — still handled for older links) mirrors
 * `PIPELINE_STATUS_IN` in `quotes-client.tsx`
 * (bidding + legacy in_survey + awaiting_customer + awaiting_payment).
 *
 * `closed` (dashboard tab): `converted_to_job` + `rejected`.
 * Legacy: `won` / `lost` still map to each DB status individually.
 */
import { getServerSupabase } from "@/lib/supabase/server-cached";
import { rpcGetQuoteFunnelBundle } from "@/lib/quote-funnel-rpc";
import { fetchVirtualTabQuotes } from "@/lib/quote-virtual-tab-list";
import type { Quote } from "@/types/database";
import type { ListResult } from "@/services/base";

/** Must match `PIPELINE_STATUS_IN` in `listQuotesForPage` (quotes-client). */
const PIPELINE_STATUS = ["bidding", "in_survey", "awaiting_customer", "awaiting_payment"] as const;

interface FetchQuotesOptions {
  status?: string;
  pageSize?: number;
}

export async function fetchInitialQuotes(
  opts: FetchQuotesOptions = {},
): Promise<ListResult<Quote> | null> {
  const pageSize = opts.pageSize ?? 10;
  const status   = opts.status ?? "draft";

  try {
    const supabase = await getServerSupabase();

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

    if (status === "closed") {
      const { data, count, error } = await supabase
        .from("quotes")
        .select("*", { count: "exact" })
        .is("deleted_at", null)
        .in("status", ["converted_to_job", "rejected"])
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

    if (status === "won" || status === "lost") {
      const dbStatus = status === "won" ? "converted_to_job" : "rejected";
      const { data, count, error } = await supabase
        .from("quotes")
        .select("*", { count: "exact" })
        .is("deleted_at", null)
        .eq("status", dbStatus)
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

    /** Virtual funnel tabs — RPC (fallback to client-side bucket if migration not applied). */
    if (status === "draft" || status === "ready_to_send") {
      const tab = status === "draft" ? "new" : "ready_to_send";
      try {
        return await rpcGetQuoteFunnelBundle(supabase, tab, { page: 1, pageSize });
      } catch {
        try {
          return await fetchVirtualTabQuotes(supabase, tab, { page: 1, pageSize });
        } catch {
          return null;
        }
      }
    }

    const { data, error } = await supabase.rpc("get_quotes_list_bundle", {
      p_status: status === "all" ? null : status,
      p_search: null,
      p_limit:  pageSize,
      p_offset: 0,
    });

    if (!error && data) {
      const payload = data as { rows: Quote[]; total: number };
      const total   = payload.total ?? 0;
      return {
        data:       payload.rows ?? [],
        count:      total,
        page:       1,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      };
    }

    return null;
  } catch {
    return null;
  }
}
