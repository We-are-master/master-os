"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { JOB_LIST_ALL_TAB_STATUSES } from "@/services/jobs";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { KpiCard, LiveIndicator } from "@/components/fx/primitives";
import { jobStatusLabel } from "@/lib/job-status-ui";

const SCHEDULED_STATUSES = new Set(["unassigned", "auto_assigning", "scheduled", "late"]);
const IN_PROGRESS_STATUSES = new Set(["in_progress", "final_check"]);
const ON_HOLD_STATUSES = new Set(["on_hold"]);

type Stats = {
  live_now: {
    count: number;
    unassigned: number;
    scheduled: number;
    in_progress: number;
    on_hold: number;
  };
  scheduled: { count: number; revenue: number };
  in_progress: { count: number; revenue: number };
  on_hold: { count: number; revenue: number };
  cancelled: { count: number; lostTotal: number };
};

const initial: Stats = {
  live_now: { count: 0, unassigned: 0, scheduled: 0, in_progress: 0, on_hold: 0 },
  scheduled: { count: 0, revenue: 0 },
  in_progress: { count: 0, revenue: 0 },
  on_hold: { count: 0, revenue: 0 },
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

      const [activeRes, cancelledRes] = await Promise.all([
        supabase
          .from("jobs")
          .select("status, client_price, extras_amount")
          .in("status", [...JOB_LIST_ALL_TAB_STATUSES])
          .is("deleted_at", null),
        cancelledQuery,
      ]);

      if (cancelled) return;

      type ActiveRow = {
        status: string;
        client_price: number | null;
        extras_amount: number | null;
      };
      const rows = (activeRes.data ?? []) as ActiveRow[];

      const next: Stats = {
        live_now: { count: rows.length, unassigned: 0, scheduled: 0, in_progress: 0, on_hold: 0 },
        scheduled: { count: 0, revenue: 0 },
        in_progress: { count: 0, revenue: 0 },
        on_hold: { count: 0, revenue: 0 },
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
        } else if (r.status === "on_hold") {
          next.live_now.on_hold += 1;
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

  const liveBreakdown = (() => {
    const parts: string[] = [];
    if (stats.live_now.unassigned > 0) {
      parts.push(`${stats.live_now.unassigned} unassigned`);
    }
    if (stats.live_now.scheduled > 0) {
      parts.push(`${stats.live_now.scheduled} scheduled`);
    }
    if (stats.live_now.in_progress > 0) {
      parts.push(`${stats.live_now.in_progress} in progress`);
    }
    if (stats.live_now.on_hold > 0) {
      parts.push(`${stats.live_now.on_hold} on hold`);
    }
    return parts.join(" · ") || "No active jobs yet";
  })();

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <KpiCard
        label="Live Now"
        hint="All active pipeline jobs (same statuses as Live Jobs below). Not filtered by the dashboard date range."
        variant="coral"
        value={loading ? "—" : stats.live_now.count}
        sub={loading ? "Loading…" : liveBreakdown}
        topRight={<LiveIndicator label="" />}
      />
      <KpiCard
        label={jobStatusLabel("scheduled")}
        hint="Unassigned, auto-assigning, scheduled, and late jobs right now."
        value={loading ? "—" : stats.scheduled.count}
        sub={loading ? "Loading…" : `${formatGbp(stats.scheduled.revenue)} · Revenue`}
        topRight={<StatusDot color="bg-fx-green" />}
      />
      <KpiCard
        label={jobStatusLabel("in_progress")}
        hint="In progress and final-check jobs right now."
        value={loading ? "—" : stats.in_progress.count}
        sub={loading ? "Loading…" : `${formatGbp(stats.in_progress.revenue)} · Revenue`}
        topRight={<StatusDot color="bg-fx-blue" />}
      />
      <KpiCard
        label={jobStatusLabel("on_hold")}
        value={loading ? "—" : stats.on_hold.count}
        sub={loading ? "Loading…" : `${formatGbp(stats.on_hold.revenue)} · Revenue`}
        topRight={<StatusDot color="bg-fx-amber" />}
      />
      <KpiCard
        label="Cancelled"
        hint="Jobs cancelled in the selected dashboard period. Lost revenue uses the snapshot stored at cancel time."
        variant={stats.cancelled.count > 0 ? "alert" : "default"}
        value={loading ? "—" : stats.cancelled.count}
        sub={
          loading
            ? "Loading…"
            : stats.cancelled.count === 0
              ? "None in period"
              : `${formatGbp(stats.cancelled.lostTotal)} lost`
        }
        topRight={<StatusDot color="bg-fx-red" />}
      />
    </div>
  );
}

function StatusDot({ color }: { color: string }) {
  return <span className={cn("h-1.5 w-1.5 rounded-full inline-block", color)} aria-hidden />;
}

function formatGbp(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}
