import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import { NewTicketClient } from "./new-ticket-client";
import { getServerSupabase } from "@/lib/supabase/server-cached";

export const dynamic = "force-dynamic";

export default async function NewTicketPage() {
  const auth = await requirePortalUserOrRedirect();
  const supabase = await getServerSupabase();

  // Resolve account's jobs for the optional "link to job" dropdown
  const { data: clientRows } = await supabase
    .from("clients")
    .select("id")
    .eq("source_account_id", auth.accountId)
    .is("deleted_at", null)
    .limit(1000);
  const clientIds = ((clientRows ?? []) as Array<{ id: string }>).map((c) => c.id);

  let jobs: Array<{ id: string; reference: string; title: string }> = [];
  if (clientIds.length > 0) {
    const { data } = await supabase
      .from("jobs")
      .select("id, reference, title")
      .in("client_id", clientIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    jobs = (data ?? []) as Array<{ id: string; reference: string; title: string }>;
  }

  return <NewTicketClient jobs={jobs} />;
}
