/**
 * Os leads B2C para a tela de Leads: quem começou a reservar no site, quem falou com o
 * Harvey no WhatsApp e quem o time lançou à mão. Lê os abertos e os perdidos, mais quem
 * virou cliente nos últimos 30 dias (a coluna "Customer" do quadro), com a linha do tempo
 * e se os e-mails foram abertos (marketing_touches, carimbado pelo webhook do Resend).
 */
import { createServiceClient } from "@/lib/supabase/service";
import { lerCanais, type CanalDef } from "@/lib/site-leads/manual";
import type { LeadDaTela } from "@/app/(dashboard)/website-leads/leads-do-site";

export async function carregarLeadsB2C(): Promise<{ leads: LeadDaTela[]; canais: CanalDef[] } | { erro: string }> {
  const sb = createServiceClient();
  const { data: abertos, error } = await sb
    .from("site_leads")
    .select("*")
    .neq("status", "won")
    .order("last_activity_at", { ascending: false })
    .limit(2000);
  if (error) return { erro: error.message };
  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: ganhos } = await sb.from("site_leads").select("*").eq("status", "won").gte("won_at", desde).order("won_at", { ascending: false }).limit(300);
  const leads = [...(abertos ?? []), ...(ganhos ?? [])];

  const ids = leads.map((l) => l.id as string);
  const { data: atividades } = ids.length
    ? await sb.from("site_lead_activity").select("*").in("lead_id", ids).order("at", { ascending: false }).limit(3000)
    : { data: [] as Record<string, unknown>[] };

  const providerIds = (atividades ?? []).map((a) => a.provider_id as string | null).filter(Boolean) as string[];
  const { data: toques } = providerIds.length
    ? await sb.from("marketing_touches").select("provider_id, opened_at, clicked_at").in("provider_id", providerIds)
    : { data: [] as Record<string, unknown>[] };
  const porProvider = new Map((toques ?? []).map((t) => [t.provider_id as string, t]));

  const linhas: LeadDaTela[] = leads.map((l) => ({
    ...(l as LeadDaTela),
    atividades: (atividades ?? [])
      .filter((a) => a.lead_id === l.id)
      .map((a) => {
        const t = a.provider_id ? porProvider.get(a.provider_id as string) : undefined;
        return {
          id: a.id as string,
          at: a.at as string,
          kind: a.kind as string,
          detail: (a.detail as string) ?? "",
          opened_at: (t?.opened_at as string | null) ?? null,
          clicked_at: (t?.clicked_at as string | null) ?? null,
        };
      }),
  }));
  return { leads: linhas, canais: await lerCanais(sb) };
}
