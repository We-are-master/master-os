/**
 * Helpers for filtering operational lists (requests/quotes/jobs) by
 * Business Unit. The BU→Account relationship lives on accounts.bu_id;
 * individual requests/quotes/jobs inherit it transitively through
 * clients.source_account_id.
 */

import { getSupabase } from "./base";

/**
 * Returns the set of `accounts.id` values belonging to the given Business Unit.
 */
export async function getAccountIdsForBu(buId: string | null): Promise<Set<string>> {
  if (!buId) return new Set();
  const { data, error } = await getSupabase()
    .from("accounts")
    .select("id")
    .eq("bu_id", buId);
  if (error) {
    console.error("[getAccountIdsForBu]", error);
    return new Set();
  }
  return new Set((data ?? []).map((a) => (a as { id: string }).id));
}

/**
 * Returns the set of `clients.id` values whose `source_account_id` belongs
 * to the given Business Unit. Used by the list pages (requests/quotes/jobs)
 * to filter rows by BU without loading the entire clients/accounts graph.
 */
export async function getClientIdsForBu(buId: string | null): Promise<Set<string>> {
  if (!buId) return new Set();
  const supabase = getSupabase();
  const { data: accounts, error: accErr } = await supabase
    .from("accounts")
    .select("id")
    .eq("bu_id", buId);
  if (accErr) {
    console.error("[getClientIdsForBu] accounts", accErr);
    return new Set();
  }
  const accountIds = (accounts ?? []).map((a) => (a as { id: string }).id);
  if (accountIds.length === 0) return new Set();

  const { data: clients, error: cliErr } = await supabase
    .from("clients")
    .select("id")
    .in("source_account_id", accountIds);
  if (cliErr) {
    console.error("[getClientIdsForBu] clients", cliErr);
    return new Set();
  }
  return new Set((clients ?? []).map((c) => (c as { id: string }).id));
}
