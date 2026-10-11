"use client";

/**
 * Os dois gráficos do CEO:
 *  1. o mês acumulado contra a meta (fechado e entregue subindo, contra a reta da meta);
 *  2. de onde vem a receita do mês: contas B2B, plataformas e B2C.
 */
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { pulseMoney } from "@/lib/pulse-money-display";
import { SectionCard } from "@/components/fx/primitives";
import { usePulseCeo } from "./pulse-ceo-data";

const W = 640, H = 220, PAD = { l: 8, r: 8, t: 12, b: 22 };

export function MonthBurnUp() {
  const { data } = usePulseCeo();
  const serie = data?.acumulado ?? [];
  const meta = data?.meta ?? 0;
  const hojeDia = data ? Number(data.hoje.slice(8, 10)) : 0;
  const n = Math.max(1, serie.length);
  const topo = Math.max(meta, ...serie.map((d) => d.fechado), 1);
  const x = (dia: number) => PAD.l + ((dia - 1) / Math.max(1, n - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / topo) * (H - PAD.t - PAD.b);
  const linha = (campo: "fechado" | "entregue", ate: number) => serie.filter((d) => d.dia <= ate).map((d) => `${x(d.dia).toFixed(1)},${y(d[campo]).toFixed(1)}`).join(" ");
  const fechadoHoje = serie[hojeDia - 1]?.fechado ?? 0;
  const entregueHoje = serie[hojeDia - 1]?.entregue ?? 0;
  const metaHoje = n ? (meta * hojeDia) / n : 0;
  const fechadoFim = serie[n - 1]?.fechado ?? 0;
  return (
    <SectionCard title={<ComDica titulo="Month vs Goal" dica={data ? `Day ${hojeDia} of ${n}. The goal line says ${pulseMoney(metaHoje)} by today.` : "Booked and delivered revenue against the goal line."} />}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[220px] w-full" role="img" aria-label={`Booked ${pulseMoney(fechadoFim)} and delivered ${pulseMoney(entregueHoje)} against a goal of ${pulseMoney(meta)}`}>
        {[0.25, 0.5, 0.75, 1].map((p) => (
          <line key={p} x1={PAD.l} x2={W - PAD.r} y1={y(topo * p)} y2={y(topo * p)} className="stroke-fx-line" strokeWidth="1" />
        ))}
        {meta > 0 ? <line x1={x(1)} y1={y(meta / n)} x2={x(n)} y2={y(meta)} className="stroke-fx-mute" strokeWidth="1.5" strokeDasharray="5 4" /> : null}
        {serie.length ? <polyline points={linha("fechado", n)} fill="none" className="stroke-fx-coral/40" strokeWidth="2" /> : null}
        {serie.length ? <polyline points={linha("entregue", hojeDia)} fill="none" className="stroke-fx-coral" strokeWidth="2.5" /> : null}
        {hojeDia ? <circle cx={x(hojeDia)} cy={y(entregueHoje)} r="4" className="fill-fx-coral" /> : null}
        {hojeDia ? <line x1={x(hojeDia)} x2={x(hojeDia)} y1={PAD.t} y2={H - PAD.b} className="stroke-fx-line" strokeWidth="1" strokeDasharray="2 3" /> : null}
        {[...new Set([1, Math.ceil(n / 2), n])].map((dia) => (
          <text key={dia} x={x(dia)} y={H - 6} textAnchor={dia === 1 ? "start" : dia === n ? "end" : "middle"} className="fill-text-tertiary text-[11px]">{dia}</text>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-text-secondary">
        <span><span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full bg-fx-coral align-middle" />Delivered {pulseMoney(entregueHoje)}</span>
        <span><span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full bg-fx-coral/40 align-middle" />Booked for the month {pulseMoney(fechadoFim)} ({pulseMoney(fechadoHoje)} up to today)</span>
        <span><span aria-hidden className="mr-1.5 inline-block h-0 w-4 border-t border-dashed border-fx-mute align-middle" />Goal {pulseMoney(meta)}</span>
      </div>
    </SectionCard>
  );
}

const COR: Record<string, string> = { "B2B accounts": "bg-fx-navy", Platforms: "bg-fx-blue", B2C: "bg-fx-coral" };

export function RevenueBySource() {
  const { data } = usePulseCeo();
  const origem = data?.origem ?? [];
  const total = origem.reduce((t, o) => t + o.valor, 0);
  return (
    <SectionCard title={<ComDica titulo="Where Revenue Comes From" dica="This month, by type of customer." />}>
      <div className="flex h-3 overflow-hidden rounded-full bg-fx-paper-2" role="img" aria-label={origem.map((o) => `${o.nome} ${total ? Math.round((o.valor / total) * 100) : 0}%`).join(", ")}>
        {origem.map((o) => (total > 0 && o.valor > 0 ? <div key={o.nome} className={COR[o.nome]} style={{ width: `${(o.valor / total) * 100}%` }} /> : null))}
      </div>
      <ul className="m-0 mt-4 list-none space-y-3 p-0">
        {origem.map((o) => (
          <li key={o.nome} className="flex items-baseline gap-3">
            <span aria-hidden className={`inline-block h-2.5 w-2.5 shrink-0 translate-y-[1px] rounded-full ${COR[o.nome]}`} />
            <span className="min-w-0 flex-1 text-[13px] font-medium text-text-primary">{o.nome}</span>
            <span className="text-[12px] text-text-tertiary">{o.jobs} job{o.jobs === 1 ? "" : "s"}</span>
            <span className="w-[84px] text-right text-[13px] font-semibold tabular-nums text-text-primary">{pulseMoney(o.valor)}</span>
            <span className="w-[40px] text-right text-[12px] tabular-nums text-text-secondary">{total ? Math.round((o.valor / total) * 100) : 0}%</span>
          </li>
        ))}
        {!origem.length ? <li className="text-[13px] text-text-tertiary">Loading…</li> : null}
      </ul>
    </SectionCard>
  );
}

/** Título com a explicação no "!", no lugar da legenda embaixo. */
function ComDica({ titulo, dica }: { titulo: string; dica: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {titulo}
      <FixfyHintIcon text={dica} placement="top-start" />
    </span>
  );
}
