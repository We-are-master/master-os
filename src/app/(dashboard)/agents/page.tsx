/**
 * Agents: os agentes de IA da Fixfy em lista (dono, 07/10/2026). Hoje só o
 * Harvey no WhatsApp; cada linha leva à página do agente, onde a equipe vê os
 * números e edita o que ele sabe e decide.
 */

import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Badge } from "@/components/ui/badge";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const quando = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Never";

function seteDiasAtras(): string {
  return new Date(Date.now() - 7 * 86_400_000).toISOString();
}

export default async function AgentsPage() {
  const sb = createServiceClient();
  const desde = seteDiasAtras();
  const [{ data: conversas }, { data: leads }, { data: config }] = await Promise.all([
    sb.from("harvey_wa_conversas").select("estado, checkout_ref").gte("atualizado_em", desde).limit(1000),
    sb.from("harvey_wa_leads").select("chave").gte("enviado_em", desde).limit(1000),
    sb.from("harvey_wa_config").select("chave, valor, atualizado_em, atualizado_por"),
  ]);
  const pausado = (config ?? []).find((c) => c.chave === "pausado")?.valor === true;
  const ultimaEdicao = (config ?? [])
    .filter((c) => String(c.chave).startsWith("secao:"))
    .sort((a, b) => String(b.atualizado_em).localeCompare(String(a.atualizado_em)))[0];
  const total = conversas?.length ?? 0;
  const comEquipe = (conversas ?? []).filter((c) => c.estado !== "harvey").length;
  const links = (conversas ?? []).filter((c) => c.checkout_ref).length;

  return (
    <PageTransition>
      <div className="space-y-6 p-6">
        <PageHeader title="Agents" subtitle="The AI agents working for Fixfy. Open one to see what it knows and change how it decides." />
        <div className="overflow-x-auto rounded-xl border border-border-light">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-surface-secondary text-left text-xs text-text-tertiary">
              <tr>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Channel</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Conversations (7d)</th>
                <th className="px-4 py-3 text-right font-medium">Passed to team</th>
                <th className="px-4 py-3 text-right font-medium">Payment links</th>
                <th className="px-4 py-3 text-right font-medium">Leads contacted (7d)</th>
                <th className="px-4 py-3 font-medium">Knowledge edited</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border-light hover:bg-surface-hover">
                <td className="px-4 py-3">
                  <Link href="/agents/harvey" className="font-medium text-text-primary hover:underline">
                    Harvey
                  </Link>
                  <p className="text-xs text-text-tertiary">Sells and books jobs, looks after partners</p>
                </td>
                <td className="px-4 py-3 text-text-secondary">WhatsApp (020 4538 4668)</td>
                <td className="px-4 py-3">{pausado ? <Badge variant="warning">Paused</Badge> : <Badge variant="success" dot>Live</Badge>}</td>
                <td className="px-4 py-3 text-right tabular-nums">{total}</td>
                <td className="px-4 py-3 text-right tabular-nums">{comEquipe}</td>
                <td className="px-4 py-3 text-right tabular-nums">{links}</td>
                <td className="px-4 py-3 text-right tabular-nums">{leads?.length ?? 0}</td>
                <td className="px-4 py-3 text-text-secondary">
                  {ultimaEdicao ? `${quando(ultimaEdicao.atualizado_em as string)} · ${ultimaEdicao.atualizado_por ?? "team"}` : "Default"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </PageTransition>
  );
}
