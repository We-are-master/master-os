"use client";

/**
 * O funil do mês: quem chegou, o que foi cotado, o que fechou, o que foi entregue e o que
 * entrou de dinheiro. Lead é quem chegou até nós (site, WhatsApp, Checkatrade, lançado à
 * mão); lista de prospecção importada não conta.
 *
 * Só rótulo e número em cada passo (dono, 11/10/2026: "mais limpo e objetivo pro CEO").
 * O detalhe de cada um mora no "!".
 */
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { pulseMoney } from "@/lib/pulse-money-display";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import type { PulseCeo } from "@/lib/pulse-ceo";
import { usePulseCeo } from "./pulse-ceo-data";

const CANAL: Record<string, string> = { checkatrade: "Checkatrade", whatsapp: "WhatsApp", website: "Website", phone: "Phone", email: "Email", meta_form: "Meta form", referral: "Referral", walk_in: "Walk-in", other: "Other" };

export function MonthFunnel() {
  const { data, loading: carregandoMes } = usePulseCeo();
  // Segue o filtro do topo (15/10/2026). Sem período ("All"), fica o funil do mês.
  const { bounds, rangeLabel } = useDashboardDateRange();
  const [doPeriodo, setDoPeriodo] = useState<{ chave: string; funil: PulseCeo["funil"] } | null>(null);
  const chave = bounds ? `${bounds.fromIso}|${bounds.toIso}` : "";
  useEffect(() => {
    if (!chave) return;
    let vivo = true;
    const [de, ate] = chave.split("|");
    fetch(`/api/pulse/funil?from=${encodeURIComponent(de!)}&to=${encodeURIComponent(ate!)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((funil: PulseCeo["funil"] | null) => {
        if (vivo && funil) setDoPeriodo({ chave, funil });
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [chave]);
  const f = chave ? (doPeriodo?.chave === chave ? doPeriodo.funil : undefined) : data?.funil;
  const loading = chave ? doPeriodo?.chave !== chave : carregandoMes;
  const mes = chave
    ? rangeLabel || "Selected period"
    : data
      ? new Date(`${data.hoje}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })
      : "This month";
  const passos: Array<{ rotulo: string; valor: string; nota: string }> = [
    { rotulo: "Leads", valor: f ? String(f.leads) : "—", nota: `People who reached us (${mes}).${f?.porCanal.length ? `\n\n${f.porCanal.map((c) => `${c.n} ${CANAL[c.canal] ?? c.canal}`).join(" · ")}` : ""}` },
    { rotulo: "Quotes", valor: f ? String(f.quotes) : "—", nota: `Quotes created (${mes}).` },
    { rotulo: "Jobs booked", valor: f ? String(f.fechados.n) : "—", nota: `Jobs created (${mes}).${f ? `\n\n${pulseMoney(f.fechados.valor)}` : ""}` },
    { rotulo: "Delivered", valor: f ? String(f.entregues.n) : "—", nota: `Jobs completed (${mes}).${f ? `\n\n${pulseMoney(f.entregues.valor)}` : ""}` },
    { rotulo: "Sales", valor: f ? pulseMoney(f.fechados.valor) : "—", nota: `Value of the jobs booked (${mes}). Paid money lives in the Paid card.${f ? `\n\n${f.fechados.n} job${f.fechados.n === 1 ? "" : "s"}` : ""}` },
  ];
  const rotuloCls = "inline-flex items-center gap-[5px] text-[12px] font-semibold";
  return (
    <section aria-label={`Funnel · ${mes}`} className="overflow-hidden rounded-xl border border-fx-line bg-card">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {passos.map((p, i) => (
          <div key={p.rotulo} className="relative min-w-0 border-fx-line px-3.5 py-3 [&:not(:first-child)]:border-l">
            <p className={`${rotuloCls} text-text-secondary`}>
              {p.rotulo}
              <FixfyHintIcon text={p.nota} placement="top-start" />
            </p>
            <p className="mt-1.5 text-[20px] font-semibold leading-none tabular-nums text-text-primary">{p.valor}</p>
            {i < passos.length - 1 ? <ChevronRight aria-hidden className="absolute -right-2 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 rounded-full border border-fx-line bg-card p-0.5 text-fx-mute lg:block" /> : null}
          </div>
        ))}
        <div className="min-w-0 border-l border-fx-line bg-fx-coral-50 px-3.5 py-3">
          <p className={`${rotuloCls} text-fx-coral-p`}>
            Conversion
            <FixfyHintIcon text={`Leads of the month that became customers.${f ? `\n\n${f.convertidos} of ${f.leads} leads` : ""}`} placement="top-start" />
          </p>
          <p className="mt-1.5 text-[20px] font-semibold leading-none tabular-nums text-fx-coral-p">{f ? `${f.conversao}%` : loading ? "—" : "0%"}</p>
        </div>
      </div>
    </section>
  );
}
