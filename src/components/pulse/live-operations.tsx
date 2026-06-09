"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { JOB_LIST_ALL_TAB_STATUSES } from "@/services/jobs";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { KpiCard, LiveIndicator } from "@/components/fx/primitives";
import { jobStatusLabel } from "@/lib/job-status-ui";
import { addDaysYmd, ukTodayYmd } from "@/lib/uk-schedule-range";
import { ukWallClockToUtcIso } from "@/lib/utils/uk-time";

const SCHEDULED_STATUSES = new Set(["unassigned", "auto_assigning", "scheduled", "late"]);
const IN_PROGRESS_STATUSES = new Set(["in_progress", "final_check"]);
const ON_HOLD_STATUSES = new Set(["on_hold"]);

type Stats = {
  live_now: {
    count: number;
    unassigned: number;
    scheduled: number;
    in_progress: number;
  };
  scheduled: { count: number; revenue: number };
  on_hold: { count: number; revenue: number };
  in_progress: { count: number; revenue: number };
  daily_sales: { count: number; revenue: number };
  cancelled: { count: number; lostTotal: number };
};

const initial: Stats = {
  live_now: { count: 0, unassigned: 0, scheduled: 0, in_progress: 0 },
  scheduled: { count: 0, revenue: 0 },
  on_hold: { count: 0, revenue: 0 },
  in_progress: { count: 0, revenue: 0 },
  daily_sales: { count: 0, revenue: 0 },
  cancelled: { count: 0, lostTotal: 0 },
};

function jobValue(clientPrice: number | null, extrasAmount: number | null): number {
  return (Number(clientPrice) || 0) + (Number(extrasAmount) || 0);
}

function jobLostGbp(
  clientPrice: number | null,
  extrasAmount: number | null,
): number {
  return (Number(clientPrice) || 0) + (Number(extrasAmount) || 0);
}

/** Lowercase status label for KPI sub-lines (matches Jobs UI wording). */
function kpiStatusLabel(status: string): string {
  return jobStatusLabel(status).toLowerCase();
}

function formatGbp(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
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

export function LiveOperations() {
  const { bounds } = useDashboardDateRange();
  const [stats, setStats] = useState<Stats>(initial);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    void (async () => {
      const supabase = getSupabase();

      let cancelledQuery = supabase
        .from("jobs")
        .select("cancelled_client_price, cancelled_extras_amount")
        .eq("status", "cancelled")
        .is("deleted_at", null);

      if (bounds) {
        cancelledQuery = cancelledQuery
          .gte("cancelled_at", bounds.fromIso)
          .lte("cancelled_at", bounds.toIso);
      }

      const todayUk = ukTodayYmd();
      const todayStartIso = ukWallClockToUtcIso(todayUk, "00:00");
      const tomorrowStartIso = ukWallClockToUtcIso(addDaysYmd(todayUk, 1), "00:00");

      let dailySalesQuery = supabase
        .from("jobs")
        .select("client_price, extras_amount")
        .is("deleted_at", null);
      if (todayStartIso && tomorrowStartIso) {
        dailySalesQuery = dailySalesQuery
          .gte("created_at", todayStartIso)
          .lt("created_at", tomorrowStartIso);
      }

      const [activeRes, cancelledRes, dailySalesRes] = await Promise.all([
        supabase
          .from("jobs")
          .select("status, client_price, extras_amount")
          .in("status", [...JOB_LIST_ALL_TAB_STATUSES])
          .is("deleted_at", null),
        cancelledQuery,
        dailySalesQuery,
      ]);

      if (cancelled) return;

      type ActiveRow = {
        status: string;
        client_price: number | null;
        extras_amount: number | null;
      };
      const rows = (activeRes.data ?? []) as ActiveRow[];

      const next: Stats = {
        live_now: { count: rows.length, unassigned: 0, scheduled: 0, in_progress: 0 },
        scheduled: { count: 0, revenue: 0 },
        on_hold: { count: 0, revenue: 0 },
        in_progress: { count: 0, revenue: 0 },
        daily_sales: { count: 0, revenue: 0 },
        cancelled: { count: 0, lostTotal: 0 },
      };

      for (const r of rows) {
        const value = jobValue(r.client_price, r.extras_amount);

        if (r.status === "unassigned" || r.status === "auto_assigning") {
          next.live_now.unassigned += 1;
        } else if (r.status === "scheduled" || r.status === "late") {
          next.live_now.scheduled += 1;
        } else if (r.status === "in_progress" || r.status === "final_check") {
          next.live_now.in_progress += 1;
        }

        if (SCHEDULED_STATUSES.has(r.status)) {
          next.scheduled.count += 1;
          next.scheduled.revenue += value;
        } else if (IN_PROGRESS_STATUSES.has(r.status)) {
          next.in_progress.count += 1;
          next.in_progress.revenue += value;
        } else if (ON_HOLD_STATUSES.has(r.status)) {
          next.on_hold.count += 1;
          next.on_hold.revenue += value;
        }
      }

      type DailySaleRow = { client_price: number | null; extras_amount: number | null };
      const dailyRows = (dailySalesRes.data ?? []) as DailySaleRow[];
      next.daily_sales.count = dailyRows.length;
      next.daily_sales.revenue = dailyRows.reduce(
        (sum, r) => sum + jobValue(r.client_price, r.extras_amount),
        0,
      );

      type CancelledRow = {
        cancelled_client_price: number | null;
        cancelled_extras_amount: number | null;
      };
      const cancelledRows = (cancelledRes.data ?? []) as CancelledRow[];
      next.cancelled.count = cancelledRows.length;
      next.cancelled.lostTotal = cancelledRows.reduce(
        (sum, j) => sum + jobLostGbp(j.cancelled_client_price, j.cancelled_extras_amount),
        0,
      );

      setStats(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [bounds]);

  const liveBreakdownParts: string[] = [];
  if (stats.live_now.unassigned > 0) {
    liveBreakdownParts.push(kpiCountLine(stats.live_now.unassigned, kpiStatusLabel("unassigned")));
  }
  if (stats.live_now.scheduled > 0) {
    liveBreakdownParts.push(kpiCountLine(stats.live_now.scheduled, kpiStatusLabel("scheduled")));
  }
  if (stats.live_now.in_progress > 0) {
    liveBreakdownParts.push(
      kpiCountLine(stats.live_now.in_progress, kpiStatusLabel("in_progress")),
    );
  }
  const liveBreakdownHint = loading
    ? null
    : liveBreakdownParts.length > 0
      ? liveBreakdownParts.join(" · ")
      : "No active jobs";

  const scheduledHintMetrics = loading
    ? null
    : [
        kpiMoneyLine(stats.scheduled.revenue, "revenue"),
        stats.on_hold.count > 0
          ? `${kpiCountLine(stats.on_hold.count, kpiStatusLabel("on_hold"))} · ${formatGbp(stats.on_hold.revenue)}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 [&>*]:min-w-0">
      <KpiCard
        label="Live Now"
        hint={kpiHint(
          "All active pipeline jobs (incl. on hold in the total). Not filtered by the dashboard date range.",
          liveBreakdownHint,
        )}
        variant="coral"
        value={loading ? "—" : stats.live_now.count}
        topRight={<LiveIndicator label="" />}
      />
      <KpiCard
        label={jobStatusLabel("scheduled")}
        hint={kpiHint(
          "Unassigned, auto-assigning, scheduled, and late jobs right now.",
          scheduledHintMetrics,
        )}
        value={loading ? "—" : stats.scheduled.count}
        topRight={<StatusDot color="bg-fx-green" />}
      />
      <KpiCard
        label={jobStatusLabel("in_progress")}
        hint={kpiHint(
          "In progress and final-check jobs right now.",
          loading ? null : kpiMoneyLine(stats.in_progress.revenue, "revenue"),
        )}
        value={loading ? "—" : stats.in_progress.count}
        topRight={<StatusDot color="bg-fx-blue" />}
      />
      <KpiCard
        label="Daily Sales"
        hint={kpiHint(
          "Jobs added to the OS today (UK calendar day).",
          loading ? null : kpiMoneyLine(stats.daily_sales.revenue, "booked today"),
        )}
        value={loading ? "—" : stats.daily_sales.count}
        topRight={<StatusDot color="bg-fx-green" />}
      />
      <KpiCard
        label="Cancelled"
        hint={kpiHint(
          "Jobs cancelled in the selected dashboard period. Lost revenue uses the snapshot stored at cancel time.",
          loading ? null : kpiMoneyLine(stats.cancelled.lostTotal, "lost revenue"),
        )}
        variant={stats.cancelled.count > 0 ? "alert" : "default"}
        value={loading ? "—" : stats.cancelled.count}
        topRight={<StatusDot color="bg-fx-red" />}
      />
    </div>
  );
}

function StatusDot({ color }: { color: string }) {
  return <span className={cn("h-1.5 w-1.5 rounded-full inline-block", color)} aria-hidden />;
}
