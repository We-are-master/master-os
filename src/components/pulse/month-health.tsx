"use client";

/**
 * A saúde do mês em 5 segundos (dono, 05/11/2026: "confuso pra um CEO olhar e ver a saúde
 * da empresa"). Uma frase no topo diz se está tudo bem; embaixo, três perguntas com semáforo:
 *
 *  1. Sales: estamos vendendo? Faturamento do mês contra a meta e contra onde deveria estar hoje.
 *  2. Profit: estamos lucrando? A conta montada: receita, menos custo dos jobs, lucro bruto,
 *     menos fixos, resultado. Os mesmos números da barra da meta (useMonthGoalData).
 *  3. Cash: o dinheiro está entrando? Tudo em aberto, quanto venceu e quanto entrou no mês.
 *
 * Sempre o mês corrente de Londres, independente do filtro de datas.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { pulseMoney } from "@/lib/pulse-money-display";
import { ukTodayYmd } from "@/lib/uk-schedule-range";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { useMonthGoalData } from "./month-goal";

type Soma = { n: number; valor: number };
type Receber = { aguardando: Soma; vencido: Soma; pago: Soma };
type Sinal = "ok" | "watch" | "bad";

const SINAL: Record<Sinal, { cor: string; tinta: string }> = {
  ok: { cor: "text-fx-green", tinta: "bg-fx-green" },
  watch: { cor: "text-fx-amber", tinta: "bg-fx-amber" },
  bad: { cor: "text-fx-red", tinta: "bg-fx-red" },
};

function useReceberEmAberto(): Receber | null {
  const [d, setD] = useState<Receber | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch("/api/pulse/receber")
      .then((r) => (r.ok ? r.json() : null))
      .then((x: Receber | null) => {
        if (vivo && x) setD(x);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);
  return d;
}

function Card({ titulo, sinal, rotulo, dica, children }: { titulo: string; sinal: Sinal | null; rotulo: string; dica: string; children: React.ReactNode }) {
  return (
    <section aria-label={titulo} className="min-w-0 rounded-xl border border-fx-line bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-2 text-[12px] font-semibold text-text-secondary">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {titulo}
          <FixfyHintIcon text={dica} placement="bottom-start" />
        </span>
        {sinal ? (
          <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", SINAL[sinal].cor)}>
            <i aria-hidden className={cn("inline-block h-2 w-2 rounded-full", SINAL[sinal].tinta)} />
            {rotulo}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Linha({ rotulo, valor, tom }: { rotulo: string; valor: string; tom?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[12px] tabular-nums">
      <span className="whitespace-nowrap text-text-secondary">{rotulo}</span>
      <span className={cn("whitespace-nowrap font-medium text-text-primary", tom)}>{valor}</span>
    </div>
  );
}

export function MonthHealth() {
  const d = useMonthGoalData();
  const r = useReceberEmAberto();
  const m = pulseMoney;

  const hoje = ukTodayYmd();
  const [ano, mes, dia] = hoje.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const diasRestantes = Math.max(1, ultimoDia - dia + 1);
  const nomeDoMes = new Date(`${hoje}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });

  // 1. Vendas
  const meta = d?.meta ?? null;
  const receita = d?.receita ?? 0;
  const pct = meta ? Math.min(100, (receita / meta) * 100) : 0;
  const pctHoje = (dia / ultimoDia) * 100;
  const esperadoHoje = meta ? (meta * dia) / ultimoDia : 0;
  const atras = meta ? esperadoHoje - receita : 0;
  const ticketMedio = d && d.jobs > 0 ? receita / d.jobs : 0;
  const sinalVendas: Sinal | null = !d || !meta ? null : atras <= 0 ? "ok" : atras <= esperadoHoje * 0.15 ? "watch" : "bad";

  // 2. Lucro: a mesma conta da barra da meta.
  const bruto = d?.lucro ?? 0;
  const custoJobs = receita - bruto;
  const margem = receita > 0 ? (bruto / receita) * 100 : 0;
  const fixos = d?.fixos ?? 0;
  const resultado = bruto - fixos;
  // Ritmo, não o mês inteiro: no dia 5 o lucro bruto ainda não pagou o mês todo de fixos e
  // isso não é prejuízo. Compara com a fração dos fixos que já correu até hoje.
  const fixosAteHoje = (fixos * dia) / ultimoDia;
  const sinalLucro: Sinal | null = !d ? null : resultado >= 0 || bruto >= fixosAteHoje ? "ok" : bruto >= fixosAteHoje * 0.8 ? "watch" : "bad";

  const pctLucroBar = meta ? Math.min(pct, (Math.max(0, bruto) / meta) * 100) : 0;

  // 3. Caixa
  const aberto = r ? r.aguardando.valor + r.vencido.valor : 0;
  const pctVencido = aberto > 0 && r ? (r.vencido.valor / aberto) * 100 : 0;
  const sinalCaixa: Sinal | null = !r ? null : r.vencido.valor <= 0 ? "ok" : pctVencido < 30 ? "watch" : "bad";

  // A frase do topo: só o que pede atenção, em ordem de gravidade.
  const avisos: string[] = [];
  if (d && meta) avisos.push(atras > 0 ? `${m(atras)} behind pace` : "on pace for the target");
  if (d && fixos > 0)
    avisos.push(
      resultado >= 0
        ? `fixed costs covered with ${m(resultado)} to spare`
        : bruto >= fixosAteHoje
          ? `profit on pace for fixed costs (${m(-resultado)} still to cover)`
          : `profit ${m(fixosAteHoje - bruto)} behind the fixed costs run so far`,
    );
  if (r && r.vencido.valor > 0) avisos.push(`${m(r.vencido.valor)} overdue to chase`);
  const piores = [sinalVendas, sinalLucro, sinalCaixa];
  const geral: Sinal = piores.includes("bad") ? "bad" : piores.includes("watch") ? "watch" : "ok";
  const tintaTopo = geral === "bad" ? "bg-fx-red-50 text-fx-red" : geral === "watch" ? "bg-fx-amber-50 text-fx-amber" : "bg-fx-green-50 text-fx-green";

  return (
    <div className="space-y-3">
      <div role="status" className={cn("flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-[13px] font-medium", d || r ? tintaTopo : "bg-fx-paper-2 text-text-secondary")}>
        <i aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", d || r ? SINAL[geral].tinta : "bg-fx-mute")} />
        <span className="min-w-0">
          {d || r ? (
            <>
              <span className="font-semibold">{nomeDoMes}:</span> {avisos.length ? avisos.join(" · ") : "nothing needs your attention"}.
            </>
          ) : (
            `Loading ${nomeDoMes}…`
          )}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-3">
        <Card
          titulo="Sales"
          sinal={sinalVendas}
          rotulo={sinalVendas === "ok" ? "On pace" : "Behind"}
          dica={`Revenue this ${nomeDoMes}: every job with a visit this month that was not cancelled, open jobs included. The marker on the bar is where the month should be today if the target were hit in a straight line.`}
        >
          <p className="mt-2 whitespace-nowrap leading-none">
            <span className="text-[24px] font-semibold tracking-[-0.02em] tabular-nums text-text-primary">{d ? m(receita) : "—"}</span>
            {meta ? (
              <Link href="/settings?tab=setup&section=finance" title="Change the monthly target in Settings" className="ml-1.5 text-[13px] text-text-tertiary tabular-nums hover:text-text-primary">
                / {m(meta)}
              </Link>
            ) : null}
          </p>
          {meta ? (
            <>
              <div className="relative mt-3 h-2 rounded-full bg-fx-paper-2">
                <div className="absolute inset-y-0 left-0 rounded-full bg-fx-navy" style={{ width: `${pct}%` }} />
                {/* O lucro bruto anda junto da venda, em verde, na mesma escala da meta. */}
                <div className="absolute inset-y-0 left-0 rounded-full bg-fx-green" style={{ width: `${pctLucroBar}%` }} />
                <span aria-hidden className="absolute -top-1 h-4 w-0.5 rounded-full bg-fx-red" style={{ left: `${pctHoje}%` }} />
              </div>
              <p className="mt-2 text-[12px] text-text-tertiary tabular-nums">
                {Math.round(pct)}% · should be {m(esperadoHoje)} today · {diasRestantes} day{diasRestantes === 1 ? "" : "s"} left
              </p>
              <p className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-fx-green tabular-nums">
                <i aria-hidden className="inline-block h-1.5 w-3 rounded-full bg-fx-green" />
                Gross profit {m(bruto)}
              </p>
            </>
          ) : d ? (
            <Link href="/settings?tab=setup&section=finance" className="mt-2 inline-block text-[12px] font-medium text-fx-coral hover:underline">
              Choose the monthly target in Settings
            </Link>
          ) : null}
          <div className="mt-2.5 space-y-1">
            <Linha rotulo="Jobs" valor={d ? String(d.jobs) : "—"} />
            <Linha rotulo="Average ticket" valor={d ? m(ticketMedio) : "—"} />
          </div>
        </Card>

        <Card
          titulo="Profit"
          sinal={sinalLucro}
          rotulo={sinalLucro === "ok" ? "On pace" : sinalLucro === "watch" ? "Tight" : "Behind"}
          dica={`Month result so far: revenue minus partner and materials (gross profit), minus fixed costs (team and recurring bills). The signal compares gross profit with the share of fixed costs already run this month (${m(fixosAteHoje)} by today).${d?.estimados ? ` ${d.estimados} job${d.estimados === 1 ? "" : "s"} with no cost yet counted at the ${d.margemAlvo}% target margin.` : ""}`}
        >
          <p className={cn("mt-2 text-[24px] font-semibold leading-none tracking-[-0.02em] tabular-nums", resultado < 0 ? "text-fx-red" : "text-text-primary")}>
            {d ? m(resultado) : "—"}
          </p>
          <div className="mt-2.5 space-y-1">
            <Linha rotulo="Revenue" valor={d ? m(receita) : "—"} />
            <Linha rotulo="Job costs" valor={d ? m(custoJobs) : "—"} tom="text-text-secondary font-normal" />
            <Linha rotulo={`Gross profit${d ? ` ${Math.round(margem)}%` : ""}`} valor={d ? m(bruto) : "—"} tom="text-fx-green" />
            <Linha rotulo="Fixed costs" valor={d ? m(fixos) : "—"} tom="text-text-secondary font-normal" />
          </div>
        </Card>

        <Card
          titulo="Cash"
          sinal={sinalCaixa}
          rotulo={sinalCaixa === "ok" ? "Healthy" : "Chase"}
          dica="Every unpaid invoice, whatever the date. Overdue is past its due date and needs chasing; platforms past their date stay in on time because they pay on their own cycle. Collected is money received this month."
        >
          <p className="mt-2 whitespace-nowrap leading-none">
            <span className="text-[24px] font-semibold tracking-[-0.02em] tabular-nums text-text-primary">{r ? m(aberto) : "—"}</span>
            {r ? <span className="ml-1.5 text-[13px] text-text-tertiary tabular-nums">to collect · {r.aguardando.n + r.vencido.n}</span> : null}
          </p>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-fx-paper-2">
            {r && aberto > 0 ? (
              <>
                <div className="h-full bg-fx-line-strong" style={{ width: `${100 - pctVencido}%` }} />
                <div className="h-full bg-fx-red" style={{ width: `${pctVencido}%` }} />
              </>
            ) : null}
          </div>
          <div className="mt-2 space-y-1">
            <Linha rotulo="On time" valor={r ? m(r.aguardando.valor) : "—"} tom="font-normal" />
            <Linha rotulo={`Overdue${r ? ` · ${r.vencido.n}` : ""}`} valor={r ? m(r.vencido.valor) : "—"} tom={r && r.vencido.valor > 0 ? "text-fx-red" : undefined} />
            <Linha rotulo="Collected this month" valor={r ? m(r.pago.valor) : "—"} tom="font-normal" />
          </div>
        </Card>
      </div>
    </div>
  );
}
