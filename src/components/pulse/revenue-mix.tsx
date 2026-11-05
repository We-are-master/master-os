"use client";

/**
 * De onde vem a receita (dono, 05/11/2026): o antigo "Where Revenue Comes From" (canal do
 * mês) e o "Top Accounts" (contas do ano) num card só, no mesmo período, com seletor
 * This month / This year. A barra mostra o canal; as 5 maiores contas embaixo têm a
 * barrinha na cor do canal delas e a % do total, para a lista conversar com a barra.
 * Concentração: quando uma conta passa de 40% do período, o card avisa.
 */
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { pulseMoney } from "@/lib/pulse-money-display";
import { SectionCard } from "@/components/fx/primitives";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import type { MixDaReceita, Canal } from "@/lib/pulse-revenue-mix";

const COR: Record<Canal, string> = { "B2B accounts": "bg-fx-navy", Platforms: "bg-fx-blue", B2C: "bg-fx-coral" };
const CONCENTRACAO = 40;
type Periodo = "month" | "year";

export function RevenueMix() {
  const [periodo, setPeriodo] = useState<Periodo>("month");
  const [dados, setDados] = useState<Partial<Record<Periodo, MixDaReceita>>>({});
  useEffect(() => {
    if (dados[periodo]) return;
    let vivo = true;
    fetch(`/api/pulse/receita?period=${periodo}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: MixDaReceita | null) => {
        if (vivo && d) setDados((x) => ({ ...x, [periodo]: d }));
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [periodo, dados]);

  const d = dados[periodo] ?? null;
  const total = d?.total ?? 0;
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);
  const maior = d?.contas[0] ?? null;
  const concentrada = maior && pct(maior.valor) >= CONCENTRACAO ? maior : null;
  const rotuloPeriodo = periodo === "month" ? "this month" : "this year";

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-1.5">
          Where revenue comes from
          <FixfyHintIcon
            text={`Every job with a visit ${rotuloPeriodo} that was not cancelled, split by type of customer. The top accounts come from the same jobs, so their share adds up inside the bar.`}
            placement="top-start"
          />
        </span>
      }
      actions={
        <div className="inline-flex rounded-lg bg-fx-paper-2 p-0.5" role="tablist" aria-label="Period">
          {(["month", "year"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={periodo === p}
              onClick={() => setPeriodo(p)}
              className={cn("rounded-md px-2.5 py-1 text-[11px] font-semibold", periodo === p ? "bg-card text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary")}
            >
              {p === "month" ? "This month" : "This year"}
            </button>
          ))}
        </div>
      }
    >
      <p className="m-0 mt-1 text-[22px] font-semibold leading-none tracking-[-0.02em] text-text-primary tabular-nums">{d ? pulseMoney(total) : "—"}</p>
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-fx-paper-2" role="img" aria-label={d ? d.canais.map((c) => `${c.nome} ${pct(c.valor)}%`).join(", ") : "Loading"}>
        {d?.canais.map((c) => (c.valor > 0 ? <div key={c.nome} className={COR[c.nome]} style={{ width: `${pct(c.valor)}%` }} /> : null))}
      </div>
      <ul className="m-0 mt-3 list-none p-0">
        {(d?.canais ?? []).map((c) => (
          <li key={c.nome} className="flex items-baseline gap-3 border-b border-dotted border-fx-line-2 py-1.5 last:border-b-0">
            <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 translate-y-[1px] rounded-full", COR[c.nome])} />
            <span className="min-w-0 flex-1 text-[12px] font-medium text-text-primary">{c.nome}</span>
            <span className="text-[11px] text-text-tertiary tabular-nums">
              {c.jobs} job{c.jobs === 1 ? "" : "s"}
            </span>
            <span className="w-[76px] text-right text-[12px] font-semibold tabular-nums text-text-primary">{pulseMoney(c.valor)}</span>
            <span className="w-[34px] text-right text-[11px] tabular-nums text-text-secondary">{pct(c.valor)}%</span>
          </li>
        ))}
        {!d ? <li className="py-2 text-[12px] text-text-tertiary">Loading…</li> : null}
      </ul>

      <p className="m-0 mb-1.5 mt-4 text-[11px] font-semibold text-text-tertiary">Top accounts</p>
      {concentrada ? (
        <p className="m-0 mb-2 flex items-center gap-1.5 rounded-lg bg-fx-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-fx-amber">
          <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
          {concentrada.nome} is {pct(concentrada.valor)}% of revenue {rotuloPeriodo}
        </p>
      ) : null}
      <ul className="m-0 list-none p-0">
        {(d?.contas ?? []).map((a) => (
          <li key={a.id} className="border-b border-dotted border-fx-line-2 py-2 last:border-b-0">
            <div className="flex items-baseline gap-3">
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-primary">{a.nome}</span>
              <span className="text-[11px] text-text-tertiary tabular-nums">
                {a.jobs} job{a.jobs === 1 ? "" : "s"}
              </span>
              <span className="w-[76px] text-right text-[12px] font-semibold tabular-nums text-text-primary">{pulseMoney(a.valor)}</span>
              <span className="w-[34px] text-right text-[11px] tabular-nums text-text-secondary">{pct(a.valor)}%</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-fx-paper-2">
              <div className={cn("h-full rounded-full", COR[a.canal])} style={{ width: `${Math.max(2, pct(a.valor))}%` }} />
            </div>
          </li>
        ))}
        {d && d.contas.length === 0 ? <li className="py-2 text-[12px] text-text-tertiary">No account revenue {rotuloPeriodo}.</li> : null}
      </ul>
    </SectionCard>
  );
}
