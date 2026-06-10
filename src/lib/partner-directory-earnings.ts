import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/services/base";
import { chunkIds } from "@/lib/supabase-in-chunks";
import type { Partner } from "@/types/database";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function londonMonthStartYmd(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "2026";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}-01`;
}

export type PartnerEarningsBreakdown = {
  lifetime: number;
  monthToDate: number;
};

/**
 * Lifetime + month-to-date partner pay from assigned jobs (`partner_cost`), keyed by directory `partners.id`.
 * Matches job rows linked via `partner_id` = directory id or linked `auth_user_id`.
 */
export async function computePartnerDirectoryEarningsBreakdown(
  partners: Pick<Partner, "id" | "auth_user_id">[],
  supabase?: SupabaseClient,
): Promise<Record<string, PartnerEarningsBreakdown>> {
  const out: Record<string, PartnerEarningsBreakdown> = {};
  for (const p of partners) out[p.id] = { lifetime: 0, monthToDate: 0 };
  if (!partners.length) return out;

  const jobPartnerIdToDirId = new Map<string, string>();
  for (const p of partners) {
    jobPartnerIdToDirId.set(p.id, p.id);
    const uid = p.auth_user_id?.trim();
    if (uid) jobPartnerIdToDirId.set(uid, p.id);
  }

  const lookupIds = [...jobPartnerIdToDirId.keys()];
  const db = supabase ?? getSupabase();
  const monthStart = londonMonthStartYmd();

  for (const idChunk of chunkIds(lookupIds)) {
    const { data, error } = await db
      .from("jobs")
      .select("partner_id, partner_cost, completed_date, status")
      .in("partner_id", idChunk)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      const pid = (row as { partner_id?: string | null }).partner_id?.trim();
      const dirId = pid ? jobPartnerIdToDirId.get(pid) : undefined;
      if (!dirId) continue;
      const amt = Number((row as { partner_cost?: number }).partner_cost ?? 0);
      const bucket = out[dirId] ?? { lifetime: 0, monthToDate: 0 };
      bucket.lifetime = roundMoney(bucket.lifetime + amt);
      const completed = (row as { completed_date?: string | null }).completed_date?.trim().slice(0, 10);
      const status = (row as { status?: string }).status;
      if (completed && completed >= monthStart) {
        bucket.monthToDate = roundMoney(bucket.monthToDate + amt);
      } else if (!completed && status === "completed") {
        // Fallback when completed_date missing — count toward MTD if job is completed
        bucket.monthToDate = roundMoney(bucket.monthToDate + amt);
      }
      out[dirId] = bucket;
    }
  }

  return out;
}

/**
 * Lifetime partner pay from assigned jobs (`partner_cost`), keyed by directory `partners.id`.
 */
export async function computePartnerDirectoryEarnings(
  partners: Pick<Partner, "id" | "auth_user_id">[],
  supabase?: SupabaseClient,
): Promise<Record<string, number>> {
  const breakdown = await computePartnerDirectoryEarningsBreakdown(partners, supabase);
  const out: Record<string, number> = {};
  for (const [id, b] of Object.entries(breakdown)) out[id] = b.lifetime;
  return out;
}

export type PartnerWithEarnings = Partner & {
  month_earnings?: number;
};

export async function enrichPartnersDirectoryEarnings(
  partners: Partner[],
  supabase?: SupabaseClient,
): Promise<PartnerWithEarnings[]> {
  if (!partners.length) return partners;
  const earningsById = await computePartnerDirectoryEarningsBreakdown(partners, supabase);
  return partners.map((p) => ({
    ...p,
    total_earnings: earningsById[p.id]?.lifetime ?? p.total_earnings,
    month_earnings: earningsById[p.id]?.monthToDate ?? 0,
  }));
}
