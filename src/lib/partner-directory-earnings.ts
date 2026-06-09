import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/services/base";
import { chunkIds } from "@/lib/supabase-in-chunks";
import type { Partner } from "@/types/database";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Lifetime partner pay from assigned jobs (`partner_cost`), keyed by directory `partners.id`.
 * Matches job rows linked via `partner_id` = directory id or linked `auth_user_id`.
 */
export async function computePartnerDirectoryEarnings(
  partners: Pick<Partner, "id" | "auth_user_id">[],
  supabase?: SupabaseClient,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const p of partners) out[p.id] = 0;
  if (!partners.length) return out;

  const jobPartnerIdToDirId = new Map<string, string>();
  for (const p of partners) {
    jobPartnerIdToDirId.set(p.id, p.id);
    const uid = p.auth_user_id?.trim();
    if (uid) jobPartnerIdToDirId.set(uid, p.id);
  }

  const lookupIds = [...jobPartnerIdToDirId.keys()];
  const db = supabase ?? getSupabase();

  for (const idChunk of chunkIds(lookupIds)) {
    const { data, error } = await db
      .from("jobs")
      .select("partner_id, partner_cost")
      .in("partner_id", idChunk)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      const pid = (row as { partner_id?: string | null }).partner_id?.trim();
      const dirId = pid ? jobPartnerIdToDirId.get(pid) : undefined;
      if (!dirId) continue;
      const amt = Number((row as { partner_cost?: number }).partner_cost ?? 0);
      out[dirId] = roundMoney((out[dirId] ?? 0) + amt);
    }
  }

  return out;
}

export async function enrichPartnersDirectoryEarnings(
  partners: Partner[],
  supabase?: SupabaseClient,
): Promise<Partner[]> {
  if (!partners.length) return partners;
  const earningsById = await computePartnerDirectoryEarnings(partners, supabase);
  return partners.map((p) => ({
    ...p,
    total_earnings: earningsById[p.id] ?? p.total_earnings,
  }));
}
