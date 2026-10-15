"use client";

/**
 * O funil do mês: quem chegou, o que foi cotado, o que fechou, o que foi entregue e o que
 * entrou de dinheiro. Lead é quem chegou até nós (site, WhatsApp, Checkatrade, lançado à
 * mão); lista de prospecção importada não conta.
 *
 * Só rótulo e número em cada passo (dono, 11/10/2026: "mais limpo e objetivo pro CEO").
 * O detalhe de cada um mora no "!".
 */
import { ChevronRight } from "lucide-react";
import { pulseMoney } from "@/lib/pulse-money-display";
import { SectionCard } from "@/components/fx/primitives";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { usePulseCeo } from "./pulse-ceo-data";

const CANAL: Record<string, string> = { checkatrade: "Checkatrade", whatsapp: "WhatsApp", website: "Website", phone: "Phone", email: "Email", meta_form: "Meta form", referral: "Referral", walk_in: "Walk-in", other: "Other" };

export function MonthFunnel() {
  const { data, loading } = usePulseCeo();
  const f = data?.funil;
  const mes = data ? new Date(`${data.hoje}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" }) : "This month";
  const passos: Array<{ rotulo: string; valor: string; nota: string }> = [
    { rotulo: "Leads", valor: f ? String(f.leads) : "—", nota: `People who reached us this month.${f?.porCanal.length ? `\n\n${f.porCanal.map((c) => `${c.n} ${CANAL[c.canal] ?? c.canal}`).join(" · ")}` : ""}` },
    { rotulo: "Quotes", valor: f ? String(f.quotes) : "—", nota: "Quotes created this month." },
    { rotulo: "Jobs booked", valor: f ? String(f.fechados.n) : "—", nota: `Jobs created this month.${f ? `\n\n${pulseMoney(f.fechados.valor)}` : ""}` },
    { rotulo: "Delivered", valor: f ? String(f.entregues.n) : "—", nota: `Jobs completed this month.${f ? `\n\n${pulseMoney(f.entregues.valor)}` : ""}` },
    { rotulo: "Paid", valor: f ? pulseMoney(f.pagos.valor) : "—", nota: `Money received this month.${f ? `\n\n${f.pagos.n} invoice${f.pagos.n === 1 ? "" : "s"} paid` : ""}` },
  ];
  const rotuloCls = "inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em]";
  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-1.5">
          Funnel
          <FixfyHintIcon text={`${mes}: from lead to money in the bank.`} placement="top-start" />
        </span>
      }
    >
      <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-fx-line sm:grid-cols-3 lg:grid-cols-6">
        {passos.map((p, i) => (
          <div key={p.rotulo} className="relative min-w-0 border-fx-line px-3.5 py-2.5 [&:not(:first-child)]:border-l">
            <p className={`${rotuloCls} text-text-tertiary`}>
              {p.rotulo}
              <FixfyHintIcon text={p.nota} placement="top-start" />
            </p>
            <p className="mt-1.5 text-[20px] font-semibold leading-none tabular-nums text-text-primary">{p.valor}</p>
            {i < passos.length - 1 ? <ChevronRight aria-hidden className="absolute -right-2 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 rounded-full border border-fx-line bg-card p-0.5 text-fx-mute lg:block" /> : null}
          </div>
        ))}
        <div className="min-w-0 border-l border-fx-line bg-fx-coral-50 px-3.5 py-2.5">
          <p className={`${rotuloCls} text-fx-coral-p`}>
            Conversion
            <FixfyHintIcon text={`Leads of the month that became customers.${f ? `\n\n${f.convertidos} of ${f.leads} leads` : ""}`} placement="top-start" />
          </p>
          <p className="mt-1.5 text-[20px] font-semibold leading-none tabular-nums text-fx-coral-p">{f ? `${f.conversao}%` : loading ? "—" : "0%"}</p>
        </div>
      </div>
    </SectionCard>
  );
}
