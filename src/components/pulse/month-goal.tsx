"use client";

/**
 * A meta do mês no topo do Pulse (dono, 11/10/2026: "o que eu preciso ter atenção de
 * números como CEO todo dia"). Sempre o mês corrente de Londres, independente do filtro.
 *
 *  - Faturamento do mês = todo job com visita no mês que não foi cancelado, incluindo os
 *    abertos (sem parceiro, agendado, em andamento, em espera, final check).
 *  - Entregue = os que já foram concluídos (final check, aguardando pagamento, completo).
 *  - Custo anda junto com a venda: repasse e material dos MESMOS jobs.
 *  - A meta é a do Setup (`pulse_revenue_goal_monthly_gbp`), a mesma do placar das 8h.
 */
import { useEffect, useState } from "react";
import { getSupabase } from "@/services/base";
import { pulseMoney } from "@/lib/pulse-money-display";
import { parseFrontendSetup } from "@/lib/frontend-setup";
import { resolvePulseMonthlyRevenueGoal } from "@/lib/pulse-revenue-goal";
import { ukTodayYmd } from "@/lib/uk-schedule-range";
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

type Dados = { receita: number; custo: number; entregue: number; jobs: number; jobsEntregues: number; meta: number | null };

export function MonthGoal() {
  const [d, setD] = useState<Dados | null>(null);

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
      const [comHora, soDia, cfg] = await Promise.all([
        deIso && ateIso
          ? sb.from("jobs").select(cols).is("deleted_at", null).gte("scheduled_start_at", deIso).lt("scheduled_start_at", ateIso).limit(5000)
          : Promise.resolve({ data: [] as Linha[] }),
        sb.from("jobs").select(cols).is("deleted_at", null).is("scheduled_start_at", null).gte("scheduled_date", inicio).lt("scheduled_date", proximo).limit(5000),
        sb.from("company_settings").select("frontend_setup").limit(1).maybeSingle(),
      ]);
      if (!vivo) return;
      const linhas = [...((comHora.data ?? []) as Linha[]), ...((soDia.data ?? []) as Linha[])].filter((j) => !FORA.has(j.status));
      const v = (j: Linha) => (Number(j.client_price) || 0) + (Number(j.extras_amount) || 0);
      const c = (j: Linha) => (Number(j.partner_cost) || 0) + (Number(j.materials_cost) || 0);
      const entregues = linhas.filter((j) => ENTREGUE.has(j.status));
      const setup = parseFrontendSetup((cfg.data as { frontend_setup?: unknown } | null)?.frontend_setup);
      setD({
        receita: linhas.reduce((t, j) => t + v(j), 0),
        custo: linhas.reduce((t, j) => t + c(j), 0),
        entregue: entregues.reduce((t, j) => t + v(j), 0),
        jobs: linhas.length,
        jobsEntregues: entregues.length,
        meta: resolvePulseMonthlyRevenueGoal(setup, 0).monthlyGoal,
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
  const pctEntregue = meta && d ? Math.min(100, (d.entregue / meta) * 100) : 0;
  const porDia = meta ? falta / diasRestantes : 0;
  const ritmo = d && dia > 0 ? (d.entregue / dia) * ultimoDia : 0;
  const margem = d && d.receita > 0 ? ((d.receita - d.custo) / d.receita) * 100 : 0;
  const m = (n: number) => pulseMoney(n);

  return (
    <section aria-label="Month goal" className="rounded-xl border border-fx-line bg-fx-paper px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fx-coral">{nomeDoMes} goal</p>
        <p className="text-[22px] font-bold leading-none tracking-[-0.02em] text-text-primary tabular-nums">{d ? m(receita) : "—"}</p>
        {meta ? (
          <p className="text-[13px] text-text-secondary">
            of {m(meta)} · <span className="font-semibold text-text-primary">{m(falta)} to go</span> · {m(porDia)} a day
          </p>
        ) : (
          <p className="text-[13px] text-text-secondary">Set the monthly revenue goal in Setup</p>
        )}
        <p className="ml-auto text-[12px] text-text-tertiary">
          {diasRestantes} day{diasRestantes === 1 ? "" : "s"} left
        </p>
      </div>
      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-fx-paper-2" role="img" aria-label={`${pct.toFixed(1)}% of the goal booked, ${pctEntregue.toFixed(1)}% delivered`}>
        <div className="absolute inset-y-0 left-0 rounded-full bg-fx-coral/35" style={{ width: `${pct}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-fx-coral" style={{ width: `${pctEntregue}%` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] text-text-secondary">
        <span>
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-fx-coral align-middle" aria-hidden />
          Delivered {d ? m(d.entregue) : "—"} · {d?.jobsEntregues ?? 0} jobs
        </span>
        <span>
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-fx-coral/35 align-middle" aria-hidden />
          Booked {d ? m(receita) : "—"} · {d?.jobs ?? 0} jobs
        </span>
        <span>Gross margin {d ? `${margem.toFixed(1)}%` : "—"}</span>
        <span>On pace for {d ? m(ritmo) : "—"} delivered</span>
      </div>
    </section>
  );
}
