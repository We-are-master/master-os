"use client";

/**
 * O funil do mês: quem chegou, o que foi cotado, o que fechou, o que foi entregue e o que
 * entrou de dinheiro. Lead é quem chegou até nós (site, WhatsApp, Checkatrade, lançado à
 * mão); lista de prospecção importada não conta.
 */
import { ChevronRight } from "lucide-react";
import { pulseMoney } from "@/lib/pulse-money-display";
import { SectionCard } from "@/components/fx/primitives";
import { usePulseCeo } from "./pulse-ceo-data";

const CANAL: Record<string, string> = { checkatrade: "Checkatrade", whatsapp: "WhatsApp", website: "Website", phone: "Phone", email: "Email", meta_form: "Meta form", referral: "Referral", walk_in: "Walk-in", other: "Other" };

export function MonthFunnel() {
  const { data, loading } = usePulseCeo();
  const f = data?.funil;
  const mes = data ? new Date(`${data.hoje}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" }) : "This month";
  const passos: Array<{ rotulo: string; valor: string; nota: string }> = [
    { rotulo: "Leads", valor: f ? String(f.leads) : "—", nota: f ? f.porCanal.slice(0, 3).map((c) => `${c.n} ${CANAL[c.canal] ?? c.canal}`).join(" · ") || "none yet" : "" },
    { rotulo: "Quotes", valor: f ? String(f.quotes) : "—", nota: "created this month" },
    { rotulo: "Jobs booked", valor: f ? String(f.fechados.n) : "—", nota: f ? pulseMoney(f.fechados.valor) : "" },
    { rotulo: "Delivered", valor: f ? String(f.entregues.n) : "—", nota: f ? pulseMoney(f.entregues.valor) : "" },
    { rotulo: "Paid", valor: f ? pulseMoney(f.pagos.valor) : "—", nota: f ? `${f.pagos.n} invoice${f.pagos.n === 1 ? "" : "s"} paid` : "" },
  ];
  return (
    <SectionCard title="Funnel" subtitle={`${mes} · from lead to money in the bank`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {passos.map((p, i) => (
          <div key={p.rotulo} className="relative min-w-0 rounded-lg border border-fx-line bg-fx-paper px-4 py-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">{p.rotulo}</p>
            <p className="mt-1 text-[24px] font-bold leading-none tabular-nums text-text-primary">{p.valor}</p>
            <p className="mt-1.5 truncate text-[11.5px] text-text-secondary">{p.nota}</p>
            {i < passos.length - 1 ? <ChevronRight aria-hidden className="absolute -right-[11px] top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 rounded-full bg-card text-fx-mute lg:block" /> : null}
          </div>
        ))}
        <div className="min-w-0 rounded-lg border border-fx-coral/40 bg-fx-coral-50 px-4 py-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fx-coral-p">Conversion</p>
          <p className="mt-1 text-[24px] font-bold leading-none tabular-nums text-text-primary">{f ? `${f.conversao}%` : loading ? "—" : "0%"}</p>
          <p className="mt-1.5 truncate text-[11.5px] text-text-secondary">{f ? `${f.convertidos} of ${f.leads} leads became customers` : ""}</p>
        </div>
      </div>
    </SectionCard>
  );
}
