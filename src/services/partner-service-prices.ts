import { getSupabase, softDeleteById } from "./base";
import type { CatalogPricingMode, PartnerServicePrice } from "@/types/database";

type ListRow = PartnerServicePrice & {
  service_catalog?: { id: string; name: string; pricing_mode: CatalogPricingMode } | null;
};

export async function listPartnerServicePrices(partnerId: string): Promise<PartnerServicePrice[]> {
  if (!partnerId?.trim()) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("partner_service_prices")
    .select("*, service_catalog:catalog_service_id ( id, name, pricing_mode )")
    .eq("partner_id", partnerId.trim())
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

export async function getPartnerServicePrice(
  partnerId: string,
  catalogServiceId: string,
): Promise<PartnerServicePrice | null> {
  if (!partnerId?.trim() || !catalogServiceId?.trim()) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("partner_service_prices")
    .select("*")
    .eq("partner_id", partnerId.trim())
    .eq("catalog_service_id", catalogServiceId.trim())
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PartnerServicePrice | null) ?? null;
}

type CreateInput = Omit<PartnerServicePrice,
  | "id" | "created_at" | "updated_at" | "deleted_at"
  | "catalog_service_name" | "catalog_pricing_mode">;

/**
 * Insert or update the override for (partner, service). Avoids Postgres
 * `INSERT ... ON CONFLICT` because the live-row uniqueness is enforced by a
 * partial unique index (`WHERE deleted_at IS NULL`) which PostgREST can't
 * bind to via `?on_conflict=`. Manual select+branch is fine for office UI.
 */
export async function upsertPartnerServicePrice(input: CreateInput): Promise<PartnerServicePrice> {
  const supabase = getSupabase();
  const existing = await getPartnerServicePrice(input.partner_id, input.catalog_service_id);
  if (existing) {
    const { data, error } = await supabase
      .from("partner_service_prices")
      .update(input)
      .eq("id", existing.id)
      .is("deleted_at", null)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as PartnerServicePrice;
  }
  const { data, error } = await supabase
    .from("partner_service_prices")
    .insert(input)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as PartnerServicePrice;
}

export async function updatePartnerServicePrice(
  id: string,
  patch: Partial<PartnerServicePrice>,
): Promise<PartnerServicePrice> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("partner_service_prices")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as PartnerServicePrice;
}

export async function deletePartnerServicePrice(id: string, deletedBy?: string): Promise<void> {
  await softDeleteById("partner_service_prices", id, deletedBy);
}
