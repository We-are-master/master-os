/**
 * A categoria do serviço do job (`service_categories.slug`), que decide o formulário
 * do report (pickReportTemplate). Uma ida ao banco: o serviço com a categoria embutida.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function categoriaDoServico(sb: SupabaseClient, catalogServiceId: string | null | undefined): Promise<string | null> {
  if (!catalogServiceId) return null;
  const { data } = await sb
    .from("service_catalog")
    .select("service_categories(slug)")
    .eq("id", catalogServiceId)
    .maybeSingle();
  const cat = (data as { service_categories?: { slug?: string } | { slug?: string }[] | null } | null)?.service_categories;
  const slug = Array.isArray(cat) ? cat[0]?.slug : cat?.slug;
  return slug?.trim() || null;
}
