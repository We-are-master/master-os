"use client";

import { pulseMoney } from "@/lib/pulse-money-display";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { JOB_LIST_ALL_TAB_STATUSES } from "@/services/jobs";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { KpiCard, LiveIndicator } from "@/components/fx/primitives";
import { jobStatusLabel } from "@/lib/job-status-ui";
import { addDaysYmd, ukTodayYmd } from "@/lib/uk-schedule-range";
import { ukWallClockToUtcIso } from "@/lib/utils/uk-time";

/**
 * A operação do período escolhido no filtro (dono, 11/10/2026).
 *
 *  - Live Now, Scheduled e In Progress obedecem ao filtro de data: contam os jobs
 *    ativos cuja visita cai no período. Com "All", contam todos os ativos.
 *  - In Progress é só o que está sendo executado. Final check tem o card dele, com o
 *    valor parado esperando aprovação.
 *  - Sales today e Sales this week (dono, 23/10/2026) abrem a linha, antes do Active
 *    jobs: o que foi lançado hoje e de segunda até hoje (dia de Londres). Saíram o
 *    "Unassigned" (a aba Action required já mostra) e o "Daily Sales" (virou Sales today).
 *  - "Cancelled" saiu daqui: com "All" mostrava todos os cancelados desde sempre.
 */
const SCHEDULED_STATUSES = new Set(["unassigned", "auto_assigning", "scheduled", "late"]);

type Bucket = { count: number; revenue: number };
type Stats = {
  live_now: { count: number; unassigned: number; scheduled: number; in_progress: number; final_check: number; on_hold: number };
  scheduled: Bucket;
  in_progress: Bucket;
  final_check: Bucket;
  on_hold: Bucket;
  sales_today: Bucket;
  sales_week: Bucket;
};

const vazio = (): Bucket => ({ count: 0, revenue: 0 });
const initial: Stats = {
  live_now: { count: 0, unassigned: 0, scheduled: 0, in_progress: 0, final_check: 0, on_hold: 0 },
  scheduled: vazio(),
  in_progress: vazio(),
  final_check: vazio(),
  on_hold: vazio(),
  sales_today: vazio(),
  sales_week: vazio(),
};

function jobValue(clientPrice: number | null, extrasAmount: number | null): number {
  return (Number(clientPrice) || 0) + (Number(extrasAmount) || 0);
}

/** Lowercase status label for KPI sub-lines (matches Jobs UI wording). */
function kpiStatusLabel(status: string): string {
  return jobStatusLabel(status).toLowerCase();
}

/** Segue a lente de moeda do Pulse (GBP por padrão, BRL quando o usuário troca). */
function formatGbp(n: number): string {
  return pulseMoney(n);
}

/** `£2,852 · revenue` */
function kpiMoneyLine(amount: number, label: string): string {
  return `${formatGbp(amount)} · ${label}`;
}

/** `3 unassigned` */
function kpiCountLine(count: number, label: string): string {
  return `${count} ${label}`;
}

/** Context + metrics in the ! hint popover. */
function kpiHint(description: string, metrics?: string | null): string {
  const m = metrics?.trim();
  if (!m) return description;
  return `${description}\n\n${m}`;
}

type ActiveRow = {
  status: string;
  partner_id: string | null;
  client_price: number | null;
  extras_amount: number | null;
  scheduled_date: string | null;
  scheduled_start_at: string | null;
};

/** O instante da visita: o horário marcado, senão o meio-dia do dia agendado. */
function instanteDaVisita(r: ActiveRow): number | null {
  const t = r.scheduled_start_at ? Date.parse(r.scheduled_start_at) : NaN;
  if (Number.isFinite(t)) return t;
  const d = r.scheduled_date?.slice(0, 10);
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return Date.parse(`${d}T12:00:00Z`);
  return null;
}

export function LiveOperations() {
  const { bounds, rangeLabel } = useDashboardDateRange();
  const [stats, setStats] = useState<Stats>(initial);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    void (async () => {
      const supabase = getSupabase();

      const todayUk = ukTodayYmd();
      const todayStartIso = ukWallClockToUtcIso(todayUk, "00:00");
      const tomorrowStartIso = ukWallClockToUtcIso(addDaysYmd(todayUk, 1), "00:00");
      // Semana de segunda a hoje, no calendário de Londres.
      const diaDaSemana = new Date(`${todayUk}T12:00:00Z`).getUTCDay();
      const mondayStartIso = ukWallClockToUtcIso(addDaysYmd(todayUk, -((diaDaSemana + 6) % 7)), "00:00");

      // Vendas da semana: jobs lançados de segunda até agora; o de hoje sai daqui também.
      let weekSalesQuery = supabase.from("jobs").select("client_price, extras_amount, created_at").is("deleted_at", null);
      if (mondayStartIso && tomorrowStartIso) {
        weekSalesQuery = weekSalesQuery.gte("created_at", mondayStartIso).lt("created_at", tomorrowStartIso);
      }

      const [activeRes, weekSalesRes] = await Promise.all([
        supabase
          .from("jobs")
          .select("status, partner_id, client_price, extras_amount, scheduled_date, scheduled_start_at")
          .in("status", [...JOB_LIST_ALL_TAB_STATUSES])
          .is("deleted_at", null),
        weekSalesQuery,
      ]);

      if (cancelled) return;

      const de = bounds ? Date.parse(bounds.fromIso) : null;
      const ate = bounds ? Date.parse(bounds.toIso) : null;
      const rows = ((activeRes.data ?? []) as ActiveRow[]).filter((r) => {
        if (de == null || ate == null) return true;
        const t = instanteDaVisita(r);
        return t != null && t >= de && t <= ate;
      });

      const next: Stats = {
        live_now: { count: rows.length, unassigned: 0, scheduled: 0, in_progress: 0, final_check: 0, on_hold: 0 },
        scheduled: vazio(),
        in_progress: vazio(),
        final_check: vazio(),
        on_hold: vazio(),
        sales_today: vazio(),
        sales_week: vazio(),
      };
      const soma = (b: Bucket, v: number) => {
        b.count += 1;
        b.revenue += v;
      };

      for (const r of rows) {
        const value = jobValue(r.client_price, r.extras_amount);
        if (r.status === "unassigned" || r.status === "auto_assigning") next.live_now.unassigned += 1;
        else if (r.status === "scheduled" || r.status === "late") next.live_now.scheduled += 1;
        else if (r.status === "in_progress") next.live_now.in_progress += 1;
        else if (r.status === "final_check") next.live_now.final_check += 1;
        else if (r.status === "on_hold") next.live_now.on_hold += 1;

        if (SCHEDULED_STATUSES.has(r.status)) soma(next.scheduled, value);
        else if (r.status === "in_progress") soma(next.in_progress, value);
        else if (r.status === "final_check") soma(next.final_check, value);
        else if (r.status === "on_hold") soma(next.on_hold, value);
      }

      type SaleRow = { client_price: number | null; extras_amount: number | null; created_at: string };
      const hojeDesde = todayStartIso ? Date.parse(todayStartIso) : null;
      for (const r of (weekSalesRes.data ?? []) as SaleRow[]) {
        const value = jobValue(r.client_price, r.extras_amount);
        soma(next.sales_week, value);
        if (hojeDesde != null && Date.parse(r.created_at) >= hojeDesde) soma(next.sales_today, value);
      }

      setStats(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [bounds]);

  const periodo = bounds ? `in the selected period${rangeLabel ? ` (${rangeLabel})` : ""}` : "across all dates";

  const liveBreakdownParts: string[] = [];
  if (stats.live_now.unassigned > 0) liveBreakdownParts.push(kpiCountLine(stats.live_now.unassigned, kpiStatusLabel("unassigned")));
  if (stats.live_now.scheduled > 0) liveBreakdownParts.push(kpiCountLine(stats.live_now.scheduled, kpiStatusLabel("scheduled")));
  if (stats.live_now.in_progress > 0) liveBreakdownParts.push(kpiCountLine(stats.live_now.in_progress, kpiStatusLabel("in_progress")));
  if (stats.live_now.final_check > 0) liveBreakdownParts.push(kpiCountLine(stats.live_now.final_check, kpiStatusLabel("final_check")));
  if (stats.live_now.on_hold > 0) liveBreakdownParts.push(kpiCountLine(stats.live_now.on_hold, kpiStatusLabel("on_hold")));
  const liveBreakdownHint = loading ? null : liveBreakdownParts.length > 0 ? liveBreakdownParts.join(" · ") : "No active jobs";

  const scheduledHintMetrics = loading
    ? null
    : [
        kpiMoneyLine(stats.scheduled.revenue, "revenue"),
        stats.on_hold.count > 0 ? `${kpiCountLine(stats.on_hold.count, kpiStatusLabel("on_hold"))} · ${formatGbp(stats.on_hold.revenue)}` : null,
      ]
        .filter(Boolean)
        .join("\n");

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 [&>*]:min-w-0">
      <KpiCard
        label="Sales today"
        hint={kpiHint("Jobs added to the OS today (UK calendar day): client price plus extras.")}
        countBesideHint={loading ? null : stats.sales_today.count}
        value={loading ? "—" : formatGbp(stats.sales_today.revenue)}
        topRight={<StatusDot color="bg-fx-green" />}
      />
      <KpiCard
        label="Sales this week"
        hint={kpiHint("Jobs added to the OS since Monday (UK calendar): client price plus extras.")}
        countBesideHint={loading ? null : stats.sales_week.count}
        value={loading ? "—" : formatGbp(stats.sales_week.revenue)}
        topRight={<StatusDot color="bg-fx-green" />}
      />
      <KpiCard
        label="Active jobs"
        hint={kpiHint(`Every active job with a visit ${periodo}: unassigned, scheduled, in progress, on hold and final check.`, liveBreakdownHint)}
        variant="coral"
        value={loading ? "—" : stats.live_now.count}
        topRight={<LiveIndicator label="" />}
      />
      <KpiCard
        label={jobStatusLabel("scheduled")}
        hint={kpiHint(`Unassigned, auto-assigning, scheduled and late jobs ${periodo}.`, scheduledHintMetrics)}
        value={loading ? "—" : stats.scheduled.count}
        topRight={<StatusDot color="bg-fx-green" />}
      />
      <KpiCard
        label={jobStatusLabel("in_progress")}
        hint={kpiHint(`Jobs being carried out ${periodo}. Final review has its own card.`, loading ? null : kpiMoneyLine(stats.in_progress.revenue, "revenue"))}
        value={loading ? "—" : stats.in_progress.count}
        topRight={<StatusDot color="bg-fx-blue" />}
      />
      <KpiCard
        label="Final review"
        hint={kpiHint(`Work finished and waiting for the team to approve ${periodo}. Until then it is not invoiced or charged.`)}
        variant={stats.final_check.count > 0 ? "alert" : "default"}
        countBesideHint={loading ? null : stats.final_check.count}
        value={loading ? "—" : formatGbp(stats.final_check.revenue)}
        topRight={<StatusDot color="bg-fx-coral" />}
      />
    </div>
  );
}

function StatusDot({ color }: { color: string }) {
  return <span className={cn("h-1.5 w-1.5 rounded-full inline-block", color)} aria-hidden />;
}
