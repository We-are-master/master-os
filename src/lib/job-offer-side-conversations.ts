import type { SupabaseClient } from "@supabase/supabase-js";
import { closeSideConversation } from "@/lib/zendesk";

/** Close every auto-assign offer side conversation on a job ticket. */
export async function closeAllJobOfferSideConversations(
  supabase: SupabaseClient,
  jobId: string,
  ticketId: string,
): Promise<void> {
  const sideConversationIds = new Set<string>();

  const { data: jobRow } = await supabase
    .from("jobs")
    .select("zendesk_side_conversation_id")
    .eq("id", jobId)
    .maybeSingle();
  const onJob = (jobRow as { zendesk_side_conversation_id: string | null } | null)?.zendesk_side_conversation_id;
  if (onJob) sideConversationIds.add(onJob);

  const { data: invites } = await supabase
    .from("job_partner_invites")
    .select("zendesk_side_conversation_id")
    .eq("job_id", jobId);
  for (const invite of invites ?? []) {
    const id = (invite as { zendesk_side_conversation_id: string | null }).zendesk_side_conversation_id;
    if (id) sideConversationIds.add(id);
  }

  await Promise.all(
    [...sideConversationIds].map((sideConversationId) =>
      closeSideConversation({ ticketId, sideConversationId }).catch((err) =>
        console.error("[closeAllJobOfferSideConversations] failed:", err),
      ),
    ),
  );
}
