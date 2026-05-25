import { getServerSupabase } from "@/lib/supabase/server-cached";
import type { Lead } from "@/types/database";
import type { ListResult } from "@/services/base";

interface FetchLeadsOptions {
  status?: string;
  pageSize?: number;
}

export async function fetchInitialLeads(
  opts: FetchLeadsOptions = {},
): Promise<ListResult<Lead> | null> {
  const pageSize = opts.pageSize ?? 10;
  const status = opts.status ?? "new";

  try {
    const supabase = await getServerSupabase();
    let query = supabase
      .from("leads")
      .select("*", { count: "exact" })
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(0, pageSize - 1);

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    const { data, count, error } = await query;
    if (error) return null;

    const total = count ?? 0;
    return {
      data: (data ?? []) as Lead[],
      count: total,
      page: 1,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  } catch {
    return null;
  }
}
