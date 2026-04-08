/**
 * Server-side data loader for the Partners page.
 *
 * Calls the consolidated `get_partners_list_bundle` RPC (migration 125)
 * which returns paged rows + per-partner doc/job aggregates in one call.
 */
import { getServerSupabase } from "@/lib/supabase/server-cached";
import type { Partner } from "@/types/database";
import type { ListResult } from "@/services/base";

interface FetchPartnersOptions {
  status?: string;
  trade?: string;
  pageSize?: number;
}

export async function fetchInitialPartners(
  opts: FetchPartnersOptions = {},
): Promise<ListResult<Partner> | null> {
  const pageSize = opts.pageSize ?? 10;
  const status   = opts.status;
  const trade    = opts.trade;

  // The page treats "inactive" as the union (inactive, on_break). The bundle
  // RPC takes a single status string and can't express that today, so we
  // fall back to a direct query in that one case (mirrors listPartners
  // behaviour in src/services/partners.ts).
  if (status === "inactive") {
    return fetchInactivePartnersDirect(opts, pageSize);
  }

  try {
    const supabase = await getServerSupabase();
    const { data, error } = await supabase.rpc("get_partners_list_bundle", {
      p_status: status && status !== "all" ? status : null,
      p_trade:  trade  && trade  !== "all" ? trade  : null,
      p_search: null,
      p_limit:  pageSize,
      p_offset: 0,
    });

    if (error || !data) return null;
    const payload = data as { rows: Partner[]; total: number };
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

async function fetchInactivePartnersDirect(
  opts: FetchPartnersOptions,
  pageSize: number,
): Promise<ListResult<Partner> | null> {
  try {
    const supabase = await getServerSupabase();
    let query = supabase
      .from("partners")
      .select("*", { count: "exact" })
      .in("status", ["inactive", "on_break"])
      .order("joined_at", { ascending: false });

    if (opts.trade && opts.trade !== "all") {
      query = query.or(`trade.eq.${opts.trade},trades.cs.{${opts.trade}}`);
    }

    const { data, count, error } = await query.range(0, pageSize - 1);
    if (error || !data) return null;
    const total = count ?? 0;
    return {
      data:       data as Partner[],
      count:      total,
      page:       1,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  } catch {
    return null;
  }
}
