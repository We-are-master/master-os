"use client";

import { useEffect, useState } from "react";
import { startOfDay, endOfDay, formatISO } from "date-fns";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { KpiCard, LiveIndicator } from "@/components/fx/primitives";
import { jobStatusLabel } from "@/lib/job-status-ui";
import { parseFrontendSetup, resolveSlaRules } from "@/lib/frontend-setup";

type Stats = {
  /** Aggregate of currently-live jobs (unassigned + scheduled + in_progress).
   *  "Late" is treated as a warning label, not a separate live bucket. */
  live_now: { count: number; unassigned: number; scheduled: number; in_progress: number };
  scheduled: { count: number; revenue: number };
  in_progress: { count: number; revenue: number };
  on_hold: { count: number; revenue: number };
  sla_risk: { count: number; revenue: number; refs: string[] };
};

const initial: Stats = {
  live_now: { count: 0, unassigned: 0, scheduled: 0, in_progress: 0 },
  scheduled: { count: 0, revenue: 0 },
  in_progress: { count: 0, revenue: 0 },
  on_hold: { count: 0, revenue: 0 },
  sla_risk: { count: 0, revenue: 0, refs: [] },
};

export function LiveOperations() {
  const { bounds } = useDashboardDateRange();
  const [stats, setStats] = useState<Stats>(initial);
  const [liveTotal, setLiveTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    void (async () => {
      const supabase = getSupabase();
      const now = new Date();
      const fromIso = bounds?.fromIso ?? formatISO(startOfDay(now));
      const toIso = bounds?.toIso ?? formatISO(endOfDay(now));

      const [jobsRes, liveRes, settingsRes] = await Promise.all([
        // Period-bound query — feeds Scheduled / On Hold / SLA At Risk cards.
        supabase
          .from("jobs")
          .select(
            "id, reference, status, client_price, extras_amount, scheduled_start_at, scheduled_end_at, updated_at",
          )
          .gte("scheduled_start_at", fromIso)
          .lte("scheduled_start_at", toIso)
          .neq("status", "cancelled")
          .neq("status", "deleted")
          .is("deleted_at", null),
        // Live Now — same period filter as the rest of Pulse so the count
        // matches the date segment the user picked (Today / Week / Month / QTD).
        // "Live" = unassigned + scheduled + in_progress; late is a warning label.
        supabase
          .from("jobs")
          .select("status")
          .in("status", ["unassigned", "scheduled", "in_progress"])
          .gte("scheduled_start_at", fromIso)
          .lte("scheduled_start_at", toIso)
          .is("deleted_at", null),
        supabase.from("company_settings").select("frontend_setup").limit(1).maybeSingle(),
      ]);

      if (cancelled) return;

      type Row = {
        id: string;
        reference: string;
        status: string;
        client_price: number | null;
        extras_amount: number | null;
        scheduled_start_at: string | null;
        scheduled_end_at: string | null;
        updated_at: string | null;
      };
      const rows = (jobsRes.data ?? []) as Row[];
      const sla = resolveSlaRules(
        parseFrontendSetup(
          (settingsRes.data as { frontend_setup?: unknown } | null)?.frontend_setup,
        ),
      );
      const nowMs = Date.now();
      const ms = (h: number) => h * 60 * 60 * 1000;

      // Live Now totals come from the global query — independent of period.
      // "Live" = unassigned + scheduled + in_progress. Late is a warning label,
      // not a separate live bucket.
      type LiveRow = { status: string };
      const liveRows = (liveRes.data ?? []) as LiveRow[];
      const liveBreakdown = {
        unassigned: liveRows.filter((r) => r.status === "unassigned").length,
        scheduled: liveRows.filter((r) => r.status === "scheduled").length,
        in_progress: liveRows.filter((r) => r.status === "in_progress").length,
      };
      const live = liveRows.length;

      const next: Stats = {
        live_now: { count: live, ...liveBreakdown },
        scheduled: { count: 0, revenue: 0 },
        in_progress: { count: 0, revenue: 0 },
        on_hold: { count: 0, revenue: 0 },
        sla_risk: { count: 0, revenue: 0, refs: [] },
      };

      for (const r of rows) {
        const value = (Number(r.client_price) || 0) + (Number(r.extras_amount) || 0);
        if (r.status === "scheduled") {
          next.scheduled.count += 1;
          next.scheduled.revenue += value;
        } else if (r.status === "in_progress") {
          next.in_progress.count += 1;
          next.in_progress.revenue += value;
        } else if (r.status === "on_hold") {
          next.on_hold.count += 1;
          next.on_hold.revenue += value;
        }

        const startedAt = r.scheduled_start_at ? new Date(r.scheduled_start_at).getTime() : null;
        const updatedAt = r.updated_at ? new Date(r.updated_at).getTime() : null;
        const arrivalBreached =
          (r.status === "scheduled" || r.status === "in_progress" || r.status === "late") &&
          startedAt != null &&
          nowMs - startedAt > ms(sla.arrivalGraceHours);
        const finalChecksOverdue =
          r.status === "final_check" &&
          updatedAt != null &&
          nowMs - updatedAt > ms(sla.finalChecksHours);
        if (r.status === "late" || arrivalBreached || finalChecksOverdue) {
          next.sla_risk.count += 1;
          next.sla_risk.revenue += value;
          if (next.sla_risk.refs.length < 2) next.sla_risk.refs.push(r.reference);
        }
      }

      setStats(next);
      setLiveTotal(live);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [bounds]);

  const liveBreakdown = (() => {
    const parts: string[] = [];
    if (stats.live_now.unassigned > 0) parts.push(`${stats.live_now.unassigned} unassigned`);
    if (stats.live_now.scheduled > 0) parts.push(`${stats.live_now.scheduled} scheduled`);
    if (stats.live_now.in_progress > 0) parts.push(`${stats.live_now.in_progress} in progress`);
    return parts.join(" · ") || "No active jobs yet";
  })();

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <KpiCard
        label="Live Now"
        hint="Jobs that are Unassigned, Scheduled, or In Progress. 'Late' is a warning label on top of these, not a separate state."
        variant="coral"
        value={loading ? "—" : liveTotal}
        sub={loading ? "Loading…" : liveBreakdown}
        topRight={<LiveIndicator label="" />}
      />
      <KpiCard
        label={jobStatusLabel("scheduled")}
        value={loading ? "—" : stats.scheduled.count}
        sub={loading ? "Loading…" : `${formatGbp(stats.scheduled.revenue)} · Revenue`}
        topRight={<StatusDot color="bg-fx-green" />}
      />
      <KpiCard
        label={jobStatusLabel("in_progress")}
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
        label="SLA At Risk"
        hint="Jobs past arrival grace, with final checks overdue, or marked Late. Thresholds set in Settings → Setup → SLA."
        variant={stats.sla_risk.count > 0 ? "alert" : "default"}
        value={loading ? "—" : stats.sla_risk.count}
        sub={
          loading
            ? "Loading…"
            : stats.sla_risk.count === 0
              ? "All on track"
              : stats.sla_risk.refs.length > 0
                ? `${formatGbp(stats.sla_risk.revenue)} · ${stats.sla_risk.refs.join(" · ")}`
                : `${formatGbp(stats.sla_risk.revenue)}`
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
