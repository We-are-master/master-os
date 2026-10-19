import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServicoDoCatalogo } from "@/lib/classificar-pedido";

/** Serviços ativos do catálogo, no formato que o classificador de pedido usa. */
export async function catalogoAtivo(sb: SupabaseClient): Promise<ServicoDoCatalogo[]> {
  const { data } = await sb
    .from("service_catalog")
    .select("id, name, pricing_mode, fixed_price, hourly_rate, accepts_smart_price")
    .eq("is_active", true)
    .is("deleted_at", null);
  return ((data ?? []) as ServicoDoCatalogo[]).filter((c) => String(c.name ?? "").trim());
}
