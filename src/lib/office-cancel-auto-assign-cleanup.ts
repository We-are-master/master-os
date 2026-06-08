import type { SupabaseClient } from "@supabase/supabase-js";
import { closeAllJobOfferSideConversations } from "@/lib/job-offer-side-conversations";

/**
 * After office or Zendesk cancel: mark pending auto-assign invites lost and close offer side convs.
 */
export async function runOfficeCancelAutoAssignCleanup(
  supabase: SupabaseClient,
  jobId: string,
): Promise<void> {
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id, external_source, external_ref")
    .eq("id", jobId)
    .maybeSingle();
  if (jobErr || !job) return;

  const now = new Date().toISOString();
  await supabase
    .from("job_partner_invites")
    .update({ status: "lost", decided_at: now })
    .eq("job_id", jobId)
    .in("status", ["invited"]);

  const ticketId = (job as { external_ref?: string | null; external_source?: string | null }).external_ref;
  const isZendesk =
    (job as { external_source?: string | null }).external_source === "zendesk" && Boolean(ticketId?.trim());
  if (isZendesk && ticketId) {
    await closeAllJobOfferSideConversations(supabase, jobId, ticketId.trim());
  }
}
