import { getServerSupabase } from "@/lib/supabase/server-cached";
import { OPEN_STAGES } from "@/lib/crm/etapas";
import type { Lead, LeadStage } from "@/types/database";
import type { ListResult } from "@/services/base";
import { LeadsClient } from "./leads-client";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

/** Primeira página da aba Open, na mesma ordem de listCrmLeads (próximo passo mais antigo primeiro). */
async function fetchInitialOpenLeads(): Promise<ListResult<Lead> | null> {
  try {
    const supabase = await getServerSupabase();
    const { data, count, error } = await supabase
      .from("leads")
      .select("*", { count: "exact" })
      .is("deleted_at", null)
      .in("stage", OPEN_STAGES as LeadStage[])
      .order("next_action_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true })
      .range(0, PAGE_SIZE - 1);
    if (error) return null;
    const total = count ?? 0;
    return { data: (data ?? []) as Lead[], count: total, page: 1, pageSize: PAGE_SIZE, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
  } catch {
    return null;
  }
}

export default async function LeadsPage() {
  const initialData = await fetchInitialOpenLeads();
  return <LeadsClient initialData={initialData} />;
}
