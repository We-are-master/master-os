import { getSupabase, softDeleteById } from "./base";
import type { AccountServicePrice, CatalogPricingMode } from "@/types/database";

type ListRow = AccountServicePrice & {
  service_catalog?: { id: string; name: string; pricing_mode: CatalogPricingMode } | null;
};

/** Per-account pricing rows for THIS account, joined with the catalog name + mode. */
export async function listAccountServicePrices(accountId: string): Promise<AccountServicePrice[]> {
  if (!accountId?.trim()) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("account_service_prices")
    .select("*, service_catalog:catalog_service_id ( id, name, pricing_mode )")
    .eq("account_id", accountId.trim())
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as ListRow;
    return {
      ...r,
      catalog_service_name: r.service_catalog?.name ?? null,
      catalog_pricing_mode: r.service_catalog?.pricing_mode ?? null,
    };
  });
}

export async function getAccountServicePrice(
  accountId: string,
  catalogServiceId: string,
): Promise<AccountServicePrice | null> {
  if (!accountId?.trim() || !catalogServiceId?.trim()) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("account_service_prices")
    .select("*")
    .eq("account_id", accountId.trim())
    .eq("catalog_service_id", catalogServiceId.trim())
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AccountServicePrice | null) ?? null;
}

type CreateInput = Omit<AccountServicePrice,
  | "id" | "created_at" | "updated_at" | "deleted_at"
  | "catalog_service_name" | "catalog_pricing_mode">;

/**
 * Insert or update the override for (account, service). Doesn't use Postgres
 * `INSERT ... ON CONFLICT` because the live-row uniqueness is enforced by a
 * partial unique index (`WHERE deleted_at IS NULL`) which PostgREST can't bind
 * to via `?on_conflict=`. Manual select+branch is good enough for office UI
 * (race window is small; the partial index still defends DB-side).
 */
export async function upsertAccountServicePrice(input: CreateInput): Promise<AccountServicePrice> {
  const supabase = getSupabase();
  const existing = await getAccountServicePrice(input.account_id, input.catalog_service_id);
  if (existing) {
    const { data, error } = await supabase
      .from("account_service_prices")
      .update(input)
      .eq("id", existing.id)
      .is("deleted_at", null)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as AccountServicePrice;
  }
  const { data, error } = await supabase
    .from("account_service_prices")
    .insert(input)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as AccountServicePrice;
}

export async function updateAccountServicePrice(
  id: string,
  patch: Partial<AccountServicePrice>,
): Promise<AccountServicePrice> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("account_service_prices")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as AccountServicePrice;
}

export async function deleteAccountServicePrice(id: string, deletedBy?: string): Promise<void> {
  await softDeleteById("account_service_prices", id, deletedBy);
}
