import type { SupabaseClient } from "@supabase/supabase-js";
import { accountLinkedLabel } from "@/lib/account-display";

type AccountRow = { company_name?: string | null; contact_name?: string | null; email?: string | null };
type ClientRow = { id: string; source_account_id?: string | null; email?: string | null };

/**
 * Map `clients.id` → linked corporate account display label.
 * 1) `clients.source_account_id` → `accounts` (company / contact / email)
 * 2) If missing or broken FK: match `accounts.email` to `clients.email` (exact batch, then per-row ilike)
 */
export async function batchResolveLinkedAccountLabels(
  supabase: SupabaseClient,
  clientIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (clientIds.length === 0) return result;

  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, source_account_id, email")
    .in("id", clientIds)
    .is("deleted_at", null);

  if (error || !clients?.length) return result;

  const rows = clients as ClientRow[];
  const accountIds = [...new Set(rows.map((c) => c.source_account_id).filter(Boolean))] as string[];

  const accountById = new Map<string, AccountRow>();
  if (accountIds.length > 0) {
    const { data: accounts } = await supabase
      .from("accounts")
      .select("id, company_name, contact_name, email")
      .in("id", accountIds)
      .is("deleted_at", null);
    for (const a of accounts ?? []) {
      const row = a as AccountRow & { id: string };
      accountById.set(row.id, row);
    }
  }

  const needEmailFallback: ClientRow[] = [];

  for (const c of rows) {
    const aid = c.source_account_id?.trim();
    if (aid) {
      const acc = accountById.get(aid);
      if (acc) {
        const label = accountLinkedLabel(acc);
        result.set(c.id, label || "Linked account");
        continue;
      }
    }
    if (c.email?.trim()) needEmailFallback.push(c);
  }

  if (needEmailFallback.length === 0) return result;

  const emails = [...new Set(needEmailFallback.map((c) => c.email!.trim()))];
  const { data: byExact } = await supabase
    .from("accounts")
    .select("company_name, contact_name, email")
    .in("email", emails)
    .is("deleted_at", null);

  const normToAcc = new Map<string, AccountRow>();
  for (const a of byExact ?? []) {
    const row = a as AccountRow & { email?: string | null };
    if (!row.email?.trim()) continue;
    const n = row.email.trim().toLowerCase();
    if (!normToAcc.has(n)) normToAcc.set(n, row);
  }

  for (const c of needEmailFallback) {
    if (result.has(c.id)) continue;
    const n = c.email!.trim().toLowerCase();
    const acc = normToAcc.get(n);
    if (acc) {
      const label = accountLinkedLabel(acc);
      result.set(c.id, label || "Linked account");
    }
  }

  for (const c of needEmailFallback) {
    if (result.has(c.id)) continue;
    const raw = c.email!.trim();
    const { data: acc } = await supabase
      .from("accounts")
      .select("company_name, contact_name, email")
      .ilike("email", raw)
      .is("deleted_at", null)
      .maybeSingle();
    if (acc) {
      const label = accountLinkedLabel(acc as AccountRow);
      result.set(c.id, label || "Linked account");
    }
  }

  return result;
}
