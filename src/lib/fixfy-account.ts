import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/utils";

let cachedFixfyAccountId: string | null = null;

/**
 * Corporate account for direct / walk-in Fixfy customers (leads → clients).
 * Set `NEXT_PUBLIC_FIXFY_ACCOUNT_ID` or `FIXFY_ACCOUNT_ID` in env when the DB
 * has multiple "Fixfy" accounts; otherwise we pick the best `accounts` row match.
 */
export async function getFixfyAccountId(supabase: SupabaseClient): Promise<string> {
  const fromEnv =
    process.env.NEXT_PUBLIC_FIXFY_ACCOUNT_ID?.trim() ||
    process.env.FIXFY_ACCOUNT_ID?.trim();
  if (fromEnv && isUuid(fromEnv)) return fromEnv;

  if (cachedFixfyAccountId) return cachedFixfyAccountId;

  const { data: exact, error: exactErr } = await supabase
    .from("accounts")
    .select("id, company_name")
    .is("deleted_at", null)
    .ilike("company_name", "fixfy")
    .limit(1)
    .maybeSingle();

  if (!exactErr && exact?.id) {
    cachedFixfyAccountId = exact.id as string;
    return cachedFixfyAccountId;
  }

  const { data: rows, error } = await supabase
    .from("accounts")
    .select("id, company_name")
    .is("deleted_at", null)
    .or("company_name.ilike.%fixfy%,company_name.ilike.Fixfy%")
    .order("company_name", { ascending: true })
    .limit(20);

  if (error || !rows?.length) {
    throw new Error(
      "Fixfy account not found. Create an account named “Fixfy” in Accounts, or set NEXT_PUBLIC_FIXFY_ACCOUNT_ID in .env.local.",
    );
  }

  const sorted = [...rows].sort((a, b) => {
    const an = String(a.company_name ?? "").toLowerCase();
    const bn = String(b.company_name ?? "").toLowerCase();
    const score = (n: string) =>
      n === "fixfy" ? 0 : n.startsWith("fixfy") ? 1 : n.includes("fixfy") ? 2 : 9;
    return score(an) - score(bn);
  });

  cachedFixfyAccountId = sorted[0].id as string;
  return cachedFixfyAccountId;
}

/** Returns Fixfy corporate account id, or null when unset / not found (no throw). */
export async function tryGetFixfyAccountId(supabase: SupabaseClient): Promise<string | null> {
  try {
    return await getFixfyAccountId(supabase);
  } catch {
    return null;
  }
}
