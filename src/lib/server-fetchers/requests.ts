/**
 * Server-side data loader for the Requests page.
 *
 * Called from the RSC `page.tsx` to pre-fetch the first page of requests
 * before the client component mounts. The result is passed to the client
 * via the `initialData` prop and consumed by `useSupabaseList`, which then
 * skips its initial useEffect fetch.
 *
 * Uses the React.cache-wrapped server Supabase client so multiple server
 * components in the same render share one auth context.
 */
import { getServerSupabase } from "@/lib/supabase/server-cached";
import type { ServiceRequest } from "@/types/database";
import type { ListResult } from "@/services/base";

interface FetchRequestsOptions {
  status?: string;
  search?: string;
  pageSize?: number;
}

export async function fetchInitialRequests(
  opts: FetchRequestsOptions = {},
): Promise<ListResult<ServiceRequest> | null> {
  const pageSize = opts.pageSize ?? 10;
  try {
    const supabase = await getServerSupabase();
    const { data, error } = await supabase.rpc("get_requests_list_bundle", {
      p_status: opts.status && opts.status !== "all" ? opts.status : null,
      p_search: opts.search?.trim() || null,
      p_limit:  pageSize,
      p_offset: 0,
    });

    if (error || !data) return null;

    const payload = data as { rows: ServiceRequest[]; total: number };
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
