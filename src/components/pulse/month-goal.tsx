"use client";

/**
 * A meta do mês no topo do Pulse (dono, 11/10/2026: "o que eu preciso ter atenção de
 * números como CEO todo dia"). Sempre o mês corrente de Londres, independente do filtro.
 *
 *  - Faturamento do mês = todo job com visita no mês que não foi cancelado, incluindo os
 *    abertos (sem parceiro, agendado, em andamento, em espera, final check).
 *  - Entregue = os que já foram concluídos (final check, aguardando pagamento, completo).
 *  - Custo anda junto com a venda: repasse e material dos MESMOS jobs.
 *  - A meta é a que o time escolhe em Settings > Setup ("Pulse · Revenue goal"), a mesma
 *    do placar das 8h. Nenhum número fixo aqui: sem meta, o card pede para escolher.
 *  - Contas fixas (dono, 02/11/2026: "até onde tenho que chegar pra pagar as contas
 *    fixas"): folha + bills recorrentes por mês, divididos pela margem bruta alvo. É o
 *    mesmo Breakeven de Settings.
 *  - Barra (dono, 02/11/2026: "faturamento, custos e lucro na barra"): tudo em £ na escala
 *    da meta. Faturamento em navy e o lucro bruto em verde vindo atrás
 *    dele, os dois com brilho de espelho; o trecho vermelho claro vai até o valor das contas fixas, porque é
 *    o LUCRO que paga a Fixfy. Verde passando do tracinho = contas do mês pagas.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { getSupabase } from "@/services/base";
import { pulseMoney } from "@/lib/pulse-money-display";
import { parseFrontendSetup } from "@/lib/frontend-setup";
import { computeMonthlyBillsBurn, computeWorkforceMonthlyBurn, type PulseBillRow } from "@/lib/pulse-fixed-costs";
import { computeBreakevenMonthly } from "@/lib/pulse-revenue-goal";
import { WORKFORCE_COST_ACTIVE_OR_FILTER } from "@/lib/workforce-lifecycle";
import { resolvePulseMonthlyRevenueGoal } from "@/lib/pulse-revenue-goal";
import { ukTodayYmd } from "@/lib/uk-schedule-range";
import { usePulseCeo } from "./pulse-ceo-data";
import { ukWallClockToUtcIso } from "@/lib/utils/uk-time";

const FORA = new Set(["cancelled", "deleted"]);
const ENTREGUE = new Set(["final_check", "awaiting_payment", "completed"]);

type Linha = {
  status: string;
  client_price: number | null;
  extras_amount: number | null;
  partner_cost: number | null;
  materials_cost: number | null;
};

type Dados = { receita: number; custo: number; lucro: number; estimados: number; entregue: number; jobs: number; jobsEntregues: number; meta: number | null; fixos: number; empate: number | null; margemAlvo: number };

export function MonthGoal() {
  const [d, setD] = useState<Dados | null>(null);
  const { data: ceo } = usePulseCeo();

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const sb = getSupabase();
      const hoje = ukTodayYmd();
      const inicio = `${hoje.slice(0, 8)}01`;
      const [ano, mes] = hoje.split("-").map(Number);
      const proximo = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;
      const deIso = ukWallClockToUtcIso(inicio, "00:00");
      const ateIso = ukWallClockToUtcIso(proximo, "00:00");
      const cols = "status, client_price, extras_amount, partner_cost, materials_cost";
      // Job com horário marcado entra pelo horário; job só com o dia entra pelo dia.
      const [comHora, soDia, cfg, folha, bills] = await Promise.all([
        deIso && ateIso
          ? sb.from("jobs").select(cols).is("deleted_at", null).gte("scheduled_start_at", deIso).lt("scheduled_start_at", ateIso).limit(5000)
          : Promise.resolve({ data: [] as Linha[] }),
        sb.from("jobs").select(cols).is("deleted_at", null).is("scheduled_start_at", null).gte("scheduled_date", inicio).lt("scheduled_date", proximo).limit(5000),
        sb.from("company_settings").select("frontend_setup").limit(1).maybeSingle(),
        sb.from("payroll_internal_costs").select("amount, lifecycle_stage").or(WORKFORCE_COST_ACTIVE_OR_FILTER),
        sb
          .from("bills")
          .select("id, amount, is_recurring, recurrence_interval, recurring_series_id, recurring_series_end_date, status, due_date, description, category")
          .is("archived_at", null)
          .neq("status", "rejected"),
      ]);
      if (!vivo) return;
      const linhas = [...((comHora.data ?? []) as Linha[]), ...((soDia.data ?? []) as Linha[])].filter((j) => !FORA.has(j.status));
      const v = (j: Linha) => (Number(j.client_price) || 0) + (Number(j.extras_amount) || 0);
      const c = (j: Linha) => (Number(j.partner_cost) || 0) + (Number(j.materials_cost) || 0);
      const entregues = linhas.filter((j) => ENTREGUE.has(j.status));
      const setup = parseFrontendSetup((cfg.data as { frontend_setup?: unknown } | null)?.frontend_setup);
      const fixos =
        computeWorkforceMonthlyBurn((folha.data ?? []) as Array<{ amount: number | null; lifecycle_stage: string | null }>) +
        computeMonthlyBillsBurn((bills.data ?? []) as PulseBillRow[]);
      const margemAlvo = setup.target_margin_pct ?? 0;
      // Job ainda sem custo (sem parceiro) contaria 100% de lucro; entra pela margem alvo.
      const semCusto = linhas.filter((j) => c(j) === 0 && !ENTREGUE.has(j.status));
      const lucro = linhas.reduce((t, j) => t + (c(j) === 0 && !ENTREGUE.has(j.status) ? (v(j) * margemAlvo) / 100 : v(j) - c(j)), 0);
      setD({
        lucro,
        estimados: semCusto.length,
        receita: linhas.reduce((t, j) => t + v(j), 0),
        custo: linhas.reduce((t, j) => t + c(j), 0),
        entregue: entregues.reduce((t, j) => t + v(j), 0),
        jobs: linhas.length,
        jobsEntregues: entregues.length,
        meta: resolvePulseMonthlyRevenueGoal(setup, 0).monthlyGoal,
        fixos,
        empate: computeBreakevenMonthly(fixos, margemAlvo),
        margemAlvo,
      });
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const hoje = ukTodayYmd();
  const [ano, mes, dia] = hoje.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const diasRestantes = Math.max(1, ultimoDia - dia + 1);
  const nomeDoMes = new Date(`${hoje}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });

  const meta = d?.meta ?? null;
  const receita = d?.receita ?? 0;
  const falta = meta ? Math.max(0, meta - receita) : 0;
  const pct = meta ? Math.min(100, (receita / meta) * 100) : 0;
  const porDia = meta ? falta / diasRestantes : 0;
  const ritmo = d && dia > 0 ? (d.entregue / dia) * ultimoDia : 0;
  const margem = d && d.receita > 0 ? ((d.receita - d.custo) / d.receita) * 100 : 0;
  // Onde o mês deveria estar hoje, se a meta fosse feita em linha reta.
  const pctHoje = (dia / ultimoDia) * 100;
  const esperadoHoje = meta ? (meta * dia) / ultimoDia : 0;
  const atras = meta ? esperadoHoje - receita : 0;
  const m = (n: number) => pulseMoney(n);
  // Até onde a barra precisa chegar para pagar as contas fixas.
  const empate = d?.empate && d.empate > 0 ? d.empate : null;
  const fixos = d && d.fixos > 0 ? d.fixos : null;
  const lucro = Math.max(0, d?.lucro ?? 0);
  const pctFixos = meta && fixos ? Math.min(100, (fixos / meta) * 100) : 0;
  const pctLucro = meta ? Math.min(pct, (lucro / meta) * 100) : 0;
  const faltaLucro = fixos ? Math.max(0, fixos - lucro) : 0;

  // O detalhe mora no "!": o card mostra só o número, a barra e a distância da meta
  // (dono, 11/10/2026: "muita info, queria algo mais visual").
  const dica = d
    ? [
        "Uses the current London calendar month, independently of the page date filter.",
        `Booked: ${m(receita)} in ${d.jobs} jobs (everything with a visit this month, open jobs included).`,
        `Delivered: ${m(d.entregue)} in ${d.jobsEntregues} jobs.`,
        `Gross margin: ${margem.toFixed(1)}%.`,
        ceo ? `Conversion: ${ceo.funil.conversao}% (${ceo.funil.convertidos} of ${ceo.funil.leads} leads).` : null,
        meta ? `To hit the goal: ${m(porDia)} a day for the ${diasRestantes} days left.` : null,
        `On pace for ${m(ritmo)} delivered by the end of the month.`,
        meta ? `The marker on the bar is where the month should be today: ${m(esperadoHoje)}.` : null,
        fixos && d
          ? `Profit (green): ${m(lucro)} so far, revenue minus partner and materials.${d.estimados ? ` ${d.estimados} job${d.estimados === 1 ? "" : "s"} with no cost yet counted at the ${d.margemAlvo}% target margin.` : ""}`
          : null,
        fixos && d
          ? `Fixed costs: ${m(fixos)} a month (team + recurring bills), the light red stretch. Profit pays them: ${faltaLucro > 0 ? `${m(faltaLucro)} of profit still to go` : "already covered"}.${empate ? ` At the ${d.margemAlvo}% target margin that takes ${m(empate)} of revenue.` : ""}`
          : null,
      ]
        .filter(Boolean)
        .join("\n\n")
    : "This month against the goal chosen in Settings.";

  return (
    <section aria-label="Monthly target" className="rounded-xl border border-fx-line bg-card px-4 py-3">
      {/* Meta numa faixa só (15/10/2026): valor, barra e distância lado a lado. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="min-w-0">
          <p className="m-0 inline-flex items-center gap-1.5 text-[11px] font-semibold text-fx-coral">
            {nomeDoMes} target
            <FixfyHintIcon label="Monthly target" text={dica} placement="bottom-start" />
            <span className="font-normal text-text-tertiary">· {diasRestantes} day{diasRestantes === 1 ? "" : "s"} left</span>
          </p>
          <p className="m-0 mt-1 whitespace-nowrap leading-none">
            <span className="text-[22px] font-semibold tracking-[-0.02em] text-text-primary tabular-nums">{d ? m(receita) : "—"}</span>
            {meta ? (
              <Link href="/settings?tab=setup&section=finance" title="Change the monthly goal in Settings" className="ml-1.5 text-[13px] text-text-tertiary tabular-nums hover:text-text-primary">
                / {m(meta)}
              </Link>
            ) : d ? (
              <Link href="/settings?tab=setup&section=finance" className="ml-2 text-[12px] font-medium text-fx-coral hover:underline">
                Choose the monthly goal in Settings
              </Link>
            ) : null}
          </p>
        </div>

        <div className="relative min-w-[200px] flex-1 pb-4">
          <div
            className="relative h-3 overflow-hidden rounded-full bg-fx-paper-2"
            role="img"
            aria-label={`Revenue ${m(receita)}, profit ${m(lucro)}${fixos ? `, fixed costs ${m(fixos)}` : ""}`}
          >
            {pctFixos > 0 ? <div className="absolute inset-y-0 left-0 bg-fx-red/15" style={{ width: `${pctFixos}%` }} /> : null}
            <div className="meta-receita absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%` }} />
            <div className="meta-lucro absolute inset-y-0 left-0 rounded-full" style={{ width: `${pctLucro}%` }} />
          </div>
          {pctFixos > 0 && fixos ? (
            <span aria-hidden title={`Fixed costs ${m(fixos)}`} className="absolute -top-0.5 h-4 w-0.5 rounded-full bg-fx-red/70" style={{ left: `${pctFixos}%` }} />
          ) : null}
          {meta ? <span aria-hidden title={`Where the month should be today: ${m(esperadoHoje)}`} className="absolute -top-1 h-5 w-px bg-text-tertiary/60" style={{ left: `${pctHoje}%` }} /> : null}
          {d ? (
            <div className="absolute inset-x-0 top-4 flex flex-wrap gap-x-3 text-[10px] font-medium tabular-nums">
              <span className="inline-flex items-center gap-1 text-text-secondary">
                <i aria-hidden className="meta-receita relative inline-block h-1.5 w-3 rounded-full" />
                Revenue {m(receita)}
              </span>
              <span className="inline-flex items-center gap-1 text-fx-green">
                <i aria-hidden className="meta-lucro relative inline-block h-1.5 w-3 rounded-full" />
                Profit {m(lucro)}
              </span>
              {fixos ? (
                <span className="inline-flex items-center gap-1 text-fx-red/80">
                  <i aria-hidden className="inline-block h-1.5 w-0.5 rounded-full bg-fx-red/70" />
                  Fixed costs {m(fixos)}
                  {faltaLucro > 0 ? ` · ${m(faltaLucro)} profit to go` : " · paid"}
                </span>
              ) : null}
            </div>
          ) : null}
          <style>{`
            .meta-receita, .meta-lucro {
              background:
                linear-gradient(180deg, rgb(255 255 255 / 0.45) 0%, rgb(255 255 255 / 0.1) 48%, rgb(0 0 0 / 0) 52%, rgb(0 0 0 / 0.12) 100%),
                var(--meta-cor);
              overflow: hidden;
            }
            .meta-receita { --meta-cor: var(--color-fx-navy); }
            .meta-lucro { --meta-cor: var(--color-fx-green); }
            .meta-receita::after, .meta-lucro::after {
              content: "";
              position: absolute;
              inset: 0;
              background: linear-gradient(105deg, transparent 35%, rgb(255 255 255 / 0.45) 50%, transparent 65%);
              transform: translateX(-100%);
              animation: meta-espelho 3.2s ease-in-out infinite;
            }
            @keyframes meta-espelho { 60%, 100% { transform: translateX(100%); } }
            .meta-lucro::after { animation-delay: 0.25s; }
            @media (prefers-reduced-motion: reduce) { .meta-receita::after, .meta-lucro::after { animation: none; display: none; } }
          `}</style>
        </div>

        {meta ? (
          <div className="flex shrink-0 items-center gap-2.5">
            {/* Tudo na mesma linha da barra (15/10/2026): falta, atraso e a porcentagem. */}
            <span className="text-[12px] text-text-tertiary tabular-nums">
              <span className="font-semibold text-text-primary">{m(falta)}</span> to go
            </span>
            <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums ${atras > 0 ? "bg-fx-red-50 text-fx-red" : "bg-fx-green/10 text-fx-green"}`}>
              {atras > 0 ? `${m(atras)} behind today` : "On pace"}
            </span>
            <span className="text-[22px] font-semibold leading-none tracking-[-0.02em] text-fx-coral tabular-nums">{Math.round(pct)}%</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
