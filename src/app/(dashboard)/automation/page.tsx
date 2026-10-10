"use client";

/**
 * Quem fez o trabalho (Fase 5): Harvey, sistema e equipe contra a meta 50/30/20,
 * e o que precisa de gente hoje. Dados de /api/admin/automation-split.
 */
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import type { Alertas, Divisao } from "@/lib/divisao-automacao";

const ATORES = [
  { id: "harvey", label: "Harvey" },
  { id: "system", label: "System" },
  { id: "human", label: "Team" },
] as const;

export default function AutomationPage() {
  const [dias, setDias] = useState(7);
  const [dados, setDados] = useState<{ divisao: Divisao; alertas: Alertas } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setDados(null);
    setErro(null);
    fetch(`/api/admin/automation-split?days=${dias}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`))))
      .then(setDados)
      .catch((e: Error) => setErro(e.message));
  }, [dias]);

  const alertas = dados?.alertas;
  const grupos: Array<[string, string[]]> = alertas
    ? [
        ["Card refused", alertas.cartaoRecusado],
        ["Card charges with no answer from Stripe", alertas.cobrancaPresa],
        ["Approved jobs on no self-bill", alertas.semSelfBill],
        ["Self-bills to fix before payday", alertas.payday],
      ]
    : [];

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Automation" subtitle="Who did the work: Harvey, the system and the team, against the 50 / 30 / 20 goal">
          <div className="flex gap-1">
            {[7, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDias(d)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${dias === d ? "bg-primary text-white" : "text-text-secondary hover:text-primary"}`}
              >
                {d} days
              </button>
            ))}
          </div>
        </PageHeader>

        {erro && <Card padding="md"><p className="text-sm text-red-600">{erro}</p></Card>}
        {!dados && !erro && (
          <Card padding="md"><Loader2 className="h-5 w-5 animate-spin text-text-secondary" /></Card>
        )}

        {dados && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              {ATORES.map((a) => {
                const pct = dados.divisao.pct[a.id];
                const meta = dados.divisao.meta[a.id];
                const bom = a.id === "human" ? pct <= meta : pct >= meta;
                return (
                  <Card key={a.id} padding="md">
                    <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">{a.label}</p>
                    <p className="mt-1 text-3xl font-bold text-text-primary">{pct}%</p>
                    <p className={`mt-1 text-xs ${bom ? "text-emerald-600" : "text-amber-600"}`}>
                      Goal {meta}% · {dados.divisao.toques[a.id]} actions
                    </p>
                    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border">
                      <div className="h-full bg-primary" style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                  </Card>
                );
              })}
            </div>

            <Card padding="md">
              <p className="text-sm font-semibold text-text-primary">How it is counted</p>
              <p className="mt-1 text-sm text-text-secondary">
                Jobs created ({dados.divisao.detalhe.criacaoDeJob.harvey} by Harvey, {dados.divisao.detalhe.criacaoDeJob.system} by the system,{" "}
                {dados.divisao.detalhe.criacaoDeJob.human} by the team), changes to jobs, quotes and invoices, and {dados.divisao.detalhe.cobrancasNoCartao} automatic card
                charges. Harvey&apos;s replies in Zendesk are not counted yet.
              </p>
            </Card>

            <Card padding="md">
              <p className="text-sm font-semibold text-text-primary">
                Needs a person today {alertas?.total ? `· ${alertas.total}` : ""}
              </p>
              {!alertas?.total && <p className="mt-1 text-sm text-text-secondary">Nothing waiting.</p>}
              {grupos
                .filter(([, itens]) => itens.length)
                .map(([titulo, itens]) => (
                  <div key={titulo} className="mt-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">{titulo}</p>
                    <ul className="mt-1 space-y-0.5 text-sm text-text-primary">
                      {itens.map((i) => (
                        <li key={i}>{i}</li>
                      ))}
                    </ul>
                  </div>
                ))}
            </Card>
          </>
        )}
      </div>
    </PageTransition>
  );
}
