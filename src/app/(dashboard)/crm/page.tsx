/**
 * Leads: uma tela só para B2C e B2B (dono, 11/10/2026: "tudo junto, com nome de lead,
 * e um toggle separando B2B e B2C, em lista e kanban").
 *
 *   /crm?side=b2c  quem parou a reserva no site, falou com o Harvey ou foi lançado à mão
 *                  (site_leads, 294)
 *   /crm?side=b2b  contas e leads de empresa, com etapas editáveis e fila de ligações
 *                  (crm_deals, 311)
 *
 * Os dois lados têm quadro e lista, e a ficha mostra o histórico com a gente
 * (src/components/leads/historico-do-lead.tsx).
 */
import { PageHeader } from "@/components/layout/page-header";
import { carregarLeadsB2C } from "@/lib/site-leads/carregar-tela";
import { LeadsDoSite } from "../website-leads/leads-do-site";
import { LadoToggle } from "@/components/leads/lado-toggle";
import { CrmClient } from "./crm-client";

export const dynamic = "force-dynamic";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ side?: string }> }) {
  const { side } = await searchParams;
  if (side === "b2b") return <CrmClient />;

  const r = await carregarLeadsB2C();
  if ("erro" in r) {
    return (
      <div className="space-y-4">
        <PageHeader title="Leads" titleAddon={<LadoToggle lado="b2c" />} />
        <p className="text-sm text-red-600">Could not read the leads ({r.erro}).</p>
      </div>
    );
  }
  return <LeadsDoSite leads={r.leads} canais={r.canais} />;
}
