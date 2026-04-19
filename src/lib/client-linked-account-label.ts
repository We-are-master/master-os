import type { SupabaseClient } from "@supabase/supabase-js";
import { accountLinkedLabel } from "@/lib/account-display";

type AccountRow = { company_name?: string | null; contact_name?: string | null; email?: string | null };
type ClientRow = { id: string; source_account_id?: string | null; email?: string | null };

const LABEL_CACHE_TTL_MS = 45_000;
let labelCache = new Map<string, string>();
let labelCacheExpiresAt = 0;

function readLabelCache(ids: string[]): { hit: Map<string, string>; missing: string[] } {
  const now = Date.now();
  if (now > labelCacheExpiresAt) {
    labelCache = new Map();
    labelCacheExpiresAt = now + LABEL_CACHE_TTL_MS;
  }
  const hit = new Map<string, string>();
  const missing: string[] = [];
  for (const id of ids) {
    const v = labelCache.get(id);
    if (v != null) hit.set(id, v);
    else missing.push(id);
  }
  return { hit, missing };
}

/** Persist labels we just resolved for `missing` ids (does not store stale empty misses). */
function mergeResolvedIntoLabelCache(missingIds: string[], out: Map<string, string>) {
  for (const id of missingIds) {
    const v = out.get(id);
    if (v !== undefined) labelCache.set(id, v);
  }
}

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

  const unique = [...new Set(clientIds.filter(Boolean))];
  const { hit, missing } = readLabelCache(unique);
  for (const [k, v] of hit) result.set(k, v);
  if (missing.length === 0) return result;

  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, source_account_id, email")
    .in("id", missing)
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

  if (needEmailFallback.length === 0) {
    mergeResolvedIntoLabelCache(missing, result);
    return result;
  }

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

  mergeResolvedIntoLabelCache(missing, result);
  return result;
}

/**
 * Map `clients.id` → linked corporate account `logo_url` (HTTPS), when `clients.source_account_id` is set.
 */
export async function batchResolveClientAccountLogoUrls(
  supabase: SupabaseClient,
  clientIds: string[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const unique = [...new Set(clientIds.filter(Boolean))];
  if (unique.length === 0) return result;

  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, source_account_id")
    .in("id", unique)
    .is("deleted_at", null);

  if (error || !clients?.length) {
    for (const id of unique) result.set(id, null);
    return result;
  }

  const rows = clients as Array<{ id: string; source_account_id?: string | null }>;
  const accountIds = [...new Set(rows.map((c) => c.source_account_id).filter(Boolean))] as string[];

  const logoByAccountId = new Map<string, string | null>();
  if (accountIds.length > 0) {
    const { data: accounts } = await supabase
      .from("accounts")
      .select("id, logo_url")
      .in("id", accountIds)
      .is("deleted_at", null);
    for (const a of accounts ?? []) {
      const row = a as { id: string; logo_url?: string | null };
      const url = row.logo_url?.trim();
      logoByAccountId.set(row.id, url && /^https?:\/\//i.test(url) ? url : null);
    }
  }

  for (const c of rows) {
    const aid = c.source_account_id?.trim();
    if (aid && logoByAccountId.has(aid)) {
      result.set(c.id, logoByAccountId.get(aid) ?? null);
    } else {
      result.set(c.id, null);
    }
  }
  for (const id of unique) {
    if (!result.has(id)) result.set(id, null);
  }
  return result;
}
