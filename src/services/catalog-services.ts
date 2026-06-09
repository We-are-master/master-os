import { getSupabase, softDeleteById, type ListParams, type ListResult } from "./base";
import type { CatalogService } from "@/types/database";

/**
 * Fire-and-forget Zendesk sync after a catalog mutation (server / dashboard only).
 * Dynamic import keeps zendesk sync modules out of client bundles that only
 * import listCatalogServicesForPicker from this file.
 */
function dispatchZendeskOptionSync(
  kind: "upsert" | "remove",
  catalogId: string,
): void {
  if (typeof window !== "undefined") return;
  void import("@/lib/zendesk-service-catalog-sync")
    .then((mod) =>
      kind === "upsert"
        ? mod.upsertCatalogOptionInZendesk(catalogId)
        : mod.removeCatalogOptionFromZendesk(catalogId),
    )
    .then((r) => {
      if (r && !r.ok && !r.skipped) {
        console.error(`[catalog-services] Zendesk ${kind} failed:`, r.error);
      }
    })
    .catch((err) => {
      console.error(`[catalog-services] Zendesk ${kind} threw:`, err);
    });
}

function dispatchZendeskBandsSync(catalogId: string, presetsRaw: unknown): void {
  if (typeof window !== "undefined") return;
  void import("@/lib/zendesk-service-bands-sync")
    .then((mod) => mod.syncBandsToZendesk(catalogId, presetsRaw))
    .then((r) => {
      if (r && !r.ok && !r.skipped) {
        console.error("[catalog-services] Zendesk bands sync failed:", r.error);
      }
    })
    .catch((err) => {
      console.error("[catalog-services] Zendesk bands sync threw:", err);
    });
}

/** List for admin UI. `params.status`: `active` / `inactive` maps to `is_active` (no `status` column on table). */
export async function listCatalogServices(params: ListParams): Promise<ListResult<CatalogService>> {
  const supabase = getSupabase();
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase.from("service_catalog").select("*", { count: "exact" }).is("deleted_at", null);

  if (params.status === "active") query = query.eq("is_active", true);
  else if (params.status === "inactive") query = query.eq("is_active", false);

  if (params.search?.trim()) {
    const s = params.search.trim();
    query = query.or(`name.ilike.%${s}%,default_description.ilike.%${s}%`);
  }

  const sortCol = params.sortBy ?? "sort_order";
  const sortDir = params.sortDir ?? "asc";
  query = query.order(sortCol, { ascending: sortDir === "asc" });
  query = query.order("name", { ascending: true });
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  return {
    data: (data ?? []) as CatalogService[],
    count: count ?? 0,
    page,
    pageSize,
    totalPages: Math.ceil((count ?? 0) / pageSize),
  };
}

/** Active, non-deleted rows for dropdowns (requests / quotes). */
export async function listCatalogServicesForPicker(): Promise<CatalogService[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("service_catalog")
    .select("*")
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CatalogService[];
}

export async function createCatalogService(
  input: Omit<CatalogService, "id" | "created_at" | "updated_at" | "deleted_at" | "deleted_by">
): Promise<CatalogService> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("service_catalog")
    .insert({ ...input, created_at: now, updated_at: now })
    .select()
    .single();
  if (error) throw new Error(error.message);
  const row = data as CatalogService;
  dispatchZendeskOptionSync("upsert", row.id);
  dispatchZendeskBandsSync(row.id, row.pricing_presets);
  return row;
}

export async function updateCatalogService(id: string, input: Partial<CatalogService>): Promise<CatalogService> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("service_catalog")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();
  if (error) throw new Error(error.message);
  const row = data as CatalogService;
  dispatchZendeskOptionSync("upsert", row.id);
  if ("pricing_presets" in input) {
    dispatchZendeskBandsSync(row.id, row.pricing_presets);
  }
  return row;
}

export async function deleteCatalogService(id: string, deletedBy?: string): Promise<void> {
  await softDeleteById("service_catalog", id, deletedBy);
  dispatchZendeskOptionSync("remove", id);
}
