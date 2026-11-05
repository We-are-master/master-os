"use client";

/**
 * Os dois gráficos do CEO:
 *  1. o mês acumulado contra a meta (fechado e entregue subindo, contra a reta da meta);
 *  2. de onde vem a receita do mês: contas B2B, plataformas e B2C.
 */
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { pulseMoney, pulseMoneyCompact } from "@/lib/pulse-money-display";
import { SectionCard } from "@/components/fx/primitives";
import { usePulseCeo } from "./pulse-ceo-data";

/**
 * Mês contra a meta (05/11/2026): o gráfico estica até a altura do card ao lado, em vez de
 * deixar um buraco embaixo. O SVG trabalha em % (viewBox 0-100, sem manter proporção) com
 * traço que não escala; o texto (eixos, legenda) e o ponto de hoje ficam em HTML.
 */
export function MonthBurnUp() {
  const { data } = usePulseCeo();
  const serie = data?.acumulado ?? [];
  const meta = data?.meta ?? 0;
  const hojeDia = data ? Number(data.hoje.slice(8, 10)) : 0;
  const n = Math.max(1, serie.length);
  const topo = Math.max(meta, ...serie.map((d) => d.fechado), 1) * 1.05;
  const x = (dia: number) => ((dia - 1) / Math.max(1, n - 1)) * 100;
  const y = (v: number) => 100 - (v / topo) * 100;
  const linha = (campo: "fechado" | "entregue", ate: number) => serie.filter((d) => d.dia <= ate).map((d) => `${x(d.dia).toFixed(2)},${y(d[campo]).toFixed(2)}`).join(" ");
  const fechadoHoje = serie[hojeDia - 1]?.fechado ?? 0;
  const entregueHoje = serie[hojeDia - 1]?.entregue ?? 0;
  const metaHoje = n ? (meta * hojeDia) / n : 0;
  const fechadoFim = serie[n - 1]?.fechado ?? 0;
  const grade = [0.25, 0.5, 0.75, 1].map((p) => (topo / 1.05) * p);
  const traco = { vectorEffect: "non-scaling-stroke" as const };
  return (
    <SectionCard
      className="flex h-full flex-col"
      bodyClassName="flex flex-1 flex-col"
      title={<ComDica titulo="Month vs Goal" dica={data ? `Day ${hojeDia} of ${n}. The goal line says ${pulseMoney(metaHoje)} by today.` : "Booked and delivered revenue against the goal line."} />}
    >
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-[22px] font-semibold leading-none tracking-[-0.02em] text-text-primary tabular-nums">{data ? pulseMoney(entregueHoje) : "—"}</span>
        <span className="text-[12px] text-text-tertiary tabular-nums">delivered · goal by today {pulseMoney(metaHoje)}</span>
      </div>
      <div className="mt-4 flex min-h-[200px] flex-1 gap-2">
        <div className="flex w-10 shrink-0 flex-col-reverse justify-between pb-5 text-right text-[10px] text-text-tertiary tabular-nums">
          <span>£0</span>
          {grade.map((v) => (
            <span key={v}>{pulseMoneyCompact(v)}</span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1 pb-5">
          <div className="relative h-full">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-label={`Booked ${pulseMoney(fechadoFim)} and delivered ${pulseMoney(entregueHoje)} against a goal of ${pulseMoney(meta)}`}>
              {grade.map((v) => (
                <line key={v} x1={0} x2={100} y1={y(v)} y2={y(v)} className="stroke-fx-line" strokeWidth="1" style={traco} />
              ))}
              <line x1={0} x2={100} y1={100} y2={100} className="stroke-fx-line-2" strokeWidth="1" style={traco} />
              {meta > 0 ? <line x1={x(1)} y1={y(meta / n)} x2={x(n)} y2={y(meta)} className="stroke-fx-mute" strokeWidth="1.5" strokeDasharray="5 4" style={traco} /> : null}
              {serie.length ? <polyline points={linha("fechado", n)} fill="none" className="stroke-fx-coral/40" strokeWidth="2" style={traco} /> : null}
              {serie.length ? <polyline points={linha("entregue", hojeDia)} fill="none" className="stroke-fx-coral" strokeWidth="2.5" style={traco} /> : null}
              {hojeDia ? <line x1={x(hojeDia)} x2={x(hojeDia)} y1={0} y2={100} className="stroke-fx-line" strokeWidth="1" strokeDasharray="2 3" style={traco} /> : null}
            </svg>
            {hojeDia ? (
              <span aria-hidden className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-fx-coral" style={{ left: `${x(hojeDia)}%`, top: `${y(entregueHoje)}%` }} />
            ) : null}
          </div>
          <div className="absolute inset-x-0 bottom-0 flex justify-between text-[10px] text-text-tertiary tabular-nums">
            {[...new Set([1, Math.ceil(n / 2), n])].map((dia) => (
              <span key={dia}>{dia}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-dotted border-fx-line-2 pt-2.5 text-[12px] text-text-secondary">
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
