"use client";

import { useEffect, useState } from "react";
import { addDays, format, startOfDay } from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
  Legend,
} from "recharts";
import { getSupabase } from "@/services/base";
import { SectionCard, Pill } from "@/components/fx/primitives";
import { PULSE_FORECAST_PAIR_CARD_CLASS } from "@/lib/pulse-layout";
import { localYmd } from "@/lib/date-range-filter";

/**
 * Jobs Forecasting — next 10 calendar days, one stacked bar per day.
 *
 * Replaces the old hour-by-hour "Today's Flow" because the operator cares more
 * about how loaded the next two weeks look than about whether jobs cluster at
 * 09 vs 14. The card keeps its grid slot + file path so other Pulse code
 * doesn't need to know about the pivot.
 *
 * Status normalisation matches the Live View Kanban / List groupings:
 *   - `auto_assigning` → unassigned
 *   - `late`, `on_hold` → scheduled (pre-start, just overdue/paused)
 *   - `awaiting_payment`, `need_attention` → final_check (wrap-up bucket)
 *   - `completed` / `cancelled` / `deleted` → filtered out (not in forecast)
 */

const FORECAST_DAYS = 10;

type StatusKey = "unassigned" | "scheduled" | "in_progress" | "final_check";

type DayBucket = {
  /** ISO YYYY-MM-DD in UK time. */
  ymd: string;
  /** Short X-axis label, e.g. "Mon 12". */
  label: string;
  /** Stable Date for tooltip formatting. */
  date: Date;
  unassigned: number;
  scheduled: number;
  in_progress: number;
  final_check: number;
};

/** Status palette — kept in sync with the Kanban + Jobs status pills. */
const COLORS: Record<StatusKey, string> = {
  unassigned: "#ED4B00", // fx-red / coral
  scheduled: "#0E8A5F", // fx-green
  in_progress: "#0B5FFF", // fx-blue
  final_check: "#7C3AED", // violet
};

const STATUS_LABEL: Record<StatusKey, string> = {
  unassigned: "Unassigned",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  final_check: "Final Checks",
};

function buildEmptyBuckets(): DayBucket[] {
  const today = startOfDay(new Date());
  return Array.from({ length: FORECAST_DAYS }, (_, i) => {
    const date = addDays(today, i);
    return {
      ymd: localYmd(date),
      label: format(date, "EEE d"),
      date,
      unassigned: 0,
      scheduled: 0,
      in_progress: 0,
      final_check: 0,
    };
  });
}

function bucketForStatus(status: string): StatusKey | null {
  switch (status) {
    case "unassigned":
    case "auto_assigning":
      return "unassigned";
    case "scheduled":
    case "late":
    case "on_hold":
      return "scheduled";
    case "in_progress":
      return "in_progress";
    case "final_check":
    case "awaiting_payment":
    case "need_attention":
      return "final_check";
    default:
      return null;
  }
}

export function TodaysFlow() {
  const [data, setData] = useState<DayBucket[]>(() => buildEmptyBuckets());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = getSupabase();
      const today = startOfDay(new Date());
      const horizon = addDays(today, FORECAST_DAYS);
      const { data: rows } = await supabase
        .from("jobs")
        .select("scheduled_start_at, status")
        .gte("scheduled_start_at", today.toISOString())
        .lt("scheduled_start_at", horizon.toISOString())
        .neq("status", "deleted")
        .neq("status", "cancelled")
        .neq("status", "completed")
        .is("deleted_at", null)
        .limit(2000);
      if (cancelled) return;
      const buckets = buildEmptyBuckets();
      const byYmd = new Map(buckets.map((b) => [b.ymd, b]));
      type Row = { scheduled_start_at: string | null; status: string };
      for (const r of (rows ?? []) as Row[]) {
        if (!r.scheduled_start_at) continue;
        const ymd = localYmd(new Date(r.scheduled_start_at));
        const bucket = byYmd.get(ymd);
        if (!bucket) continue;
        const key = bucketForStatus(r.status);
        if (!key) continue;
        bucket[key] += 1;
      }
      setData(buckets);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalAcrossWindow =
    data.reduce(
      (sum, b) => sum + b.unassigned + b.scheduled + b.in_progress + b.final_check,
      0,
    );
  const firstDay = data[0];
  const lastDay = data[data.length - 1];
  const rangeLabel = firstDay && lastDay
    ? `${format(firstDay.date, "d MMM")} → ${format(lastDay.date, "d MMM")}`
    : "";

  return (
    <SectionCard
      className={PULSE_FORECAST_PAIR_CARD_CLASS}
      bodyClassName="flex-1 min-h-0 px-5 py-4"
      title="Jobs Forecasting"
      subtitle={`Next ${FORECAST_DAYS} days · ${rangeLabel}`}
      actions={
        <>
          <Pill tone="bad">{STATUS_LABEL.unassigned}</Pill>
          <Pill tone="ok">{STATUS_LABEL.scheduled}</Pill>
          <Pill tone="info">{STATUS_LABEL.in_progress}</Pill>
          <Pill tone="violet">{STATUS_LABEL.final_check}</Pill>
        </>
      }
    >
      <div className="h-48">
        {loading ? (
          <div className="h-full bg-fx-paper-2/40 rounded animate-pulse" />
        ) : totalAcrossWindow === 0 ? (
          <div className="h-full flex items-center justify-center text-[12px] text-fx-mute">
            No jobs scheduled in the next {FORECAST_DAYS} days.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barCategoryGap={6} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="label"
                interval={0}
                tick={{ fontSize: 9.5, fill: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: "var(--chart-cursor-overlay)" }}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid var(--color-fx-line)",
                  boxShadow: "var(--shadow-fx-2)",
                  backgroundColor: "var(--card-bg)",
                  color: "var(--text-primary)",
                }}
                labelFormatter={(_v, payload) => {
                  const entry = payload?.[0]?.payload as DayBucket | undefined;
                  return entry ? format(entry.date, "EEE d MMM") : "";
                }}
                formatter={(value, name) => {
                  const key = String(name) as StatusKey;
                  return [value, STATUS_LABEL[key] ?? String(name)];
                }}
              />
              <Legend wrapperStyle={{ display: "none" }} />
              {firstDay ? (
                <ReferenceLine x={firstDay.label} stroke="var(--chart-reference-dash)" strokeDasharray="2 3" />
              ) : null}
              <Bar dataKey="unassigned" stackId="a" fill={COLORS.unassigned} radius={[0, 0, 0, 0]} />
              <Bar dataKey="scheduled" stackId="a" fill={COLORS.scheduled} radius={[0, 0, 0, 0]} />
              <Bar dataKey="in_progress" stackId="a" fill={COLORS.in_progress} radius={[0, 0, 0, 0]} />
              <Bar dataKey="final_check" stackId="a" fill={COLORS.final_check} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </SectionCard>
  );
}
