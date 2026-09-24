/**
 * Leads do site: quem começou a reservar em getfixfy.com e não pagou.
 *
 * Server component: lê os leads dos últimos 60 dias, a linha do tempo de cada
 * um e, dos e-mails que saíram, se foram abertos ou clicados (isso mora em
 * marketing_touches, carimbado pelo webhook do Resend). A tela e as ações
 * ficam no componente de cliente.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { motorLigado } from "@/lib/site-leads/motor";
import { LeadsDoSite, type LeadDaTela } from "./leads-do-site";

export const dynamic = "force-dynamic";

const DIAS = 60;

/** Fora do componente: `Date.now()` no corpo do componente o lint do React barra. */
function inicioDaJanela(): string {
  return new Date(Date.now() - DIAS * 86_400_000).toISOString();
}

export default async function WebsiteLeadsPage() {
  const sb = createServiceClient();
  const desde = inicioDaJanela();

  const { data: leads, error } = await sb
    .from("site_leads")
    .select("*")
    .gte("last_activity_at", desde)
    .order("last_activity_at", { ascending: false })
    .limit(500);

  if (error) {
    return (
      <div style={{ padding: "28px 24px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 8px" }}>Leads</h1>
        <p style={{ color: "#A5251B" }}>Não consegui ler os leads ({error.message}). Se a migration 294 ainda não rodou, é isso.</p>
      </div>
    );
  }

  const ids = (leads ?? []).map((l) => l.id as string);
  const { data: atividades } = ids.length
    ? await sb.from("site_lead_activity").select("*").in("lead_id", ids).order("at", { ascending: false }).limit(3000)
    : { data: [] as Record<string, unknown>[] };

  const providerIds = (atividades ?? []).map((a) => a.provider_id as string | null).filter(Boolean) as string[];
  const { data: toques } = providerIds.length
    ? await sb.from("marketing_touches").select("provider_id, opened_at, clicked_at").in("provider_id", providerIds)
    : { data: [] as Record<string, unknown>[] };
  const porProvider = new Map((toques ?? []).map((t) => [t.provider_id as string, t]));

  const linhas: LeadDaTela[] = (leads ?? []).map((l) => ({
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

  return <LeadsDoSite leads={linhas} motorLigado={motorLigado()} />;
}
