/**
 * Server-side data loader for the Job Detail page.
 *
 * Calls `get_job_detail_bundle` (migration 125) server-side so the page
 * arrives at the browser with job + client + partner + payments + invoice
 * + self_bill + line_items + reports + audit timeline already populated.
 */
import { getServerSupabase } from "@/lib/supabase/server-cached";
import type { JobDetailBundle } from "@/services/jobs";

export async function fetchInitialJobDetail(id: string): Promise<JobDetailBundle | null> {
  if (!id?.trim()) return null;
  try {
    const supabase = await getServerSupabase();
    const { data, error } = await supabase.rpc("get_job_detail_bundle", {
      p_job_id: id.trim(),
    });
    if (error || !data) return null;
    const payload = data as JobDetailBundle | { error: string };
    if ("error" in payload) return null;
    return payload;
  } catch {
    return null;
  }
}
