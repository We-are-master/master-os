"use client";

import { useEffect, useState } from "react";
import { startOfDay, endOfDay, formatISO, getHours } from "date-fns";
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

type HourBucket = {
  hour: number;
  label: string;
  scheduled: number;
  in_progress: number;
  late: number;
  final_check: number;
};

const HOURS = Array.from({ length: 17 }, (_, i) => i + 7); // 7am..11pm

function emptyBuckets(): HourBucket[] {
  return HOURS.map((h) => ({
    hour: h,
    label: h.toString().padStart(2, "0"),
    scheduled: 0,
    in_progress: 0,
    late: 0,
    final_check: 0,
  }));
}

/** Match JOB_STATUS_BADGE_VARIANT colors used by Job tabs. */
const COLORS = {
  scheduled: "#0E8A5F", // green (success)
  in_progress: "#0B5FFF", // blue (info)
  late: "#ED4B00", // coral (orange)
  final_check: "#7C3AED", // violet
} as const;

const STATUS_BAR_LABEL: Record<keyof typeof COLORS, string> = {
  scheduled: "Scheduled",
  in_progress: "In Progress",
  late: "Late",
  final_check: "Final Checks",
};

export function TodaysFlow() {
  const [data, setData] = useState<HourBucket[]>(() => emptyBuckets());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = getSupabase();
      const now = new Date();
      const todayStart = formatISO(startOfDay(now));
      const todayEnd = formatISO(endOfDay(now));
      const { data: rows } = await supabase
        .from("jobs")
        .select("scheduled_start_at, status")
        .gte("scheduled_start_at", todayStart)
        .lte("scheduled_start_at", todayEnd)
        .is("deleted_at", null);
      if (cancelled) return;
      const counts = emptyBuckets();
      type Row = { scheduled_start_at: string | null; status: string };
      for (const r of (rows ?? []) as Row[]) {
        if (!r.scheduled_start_at) continue;
        const h = getHours(new Date(r.scheduled_start_at));
        const slot = counts.find((c) => c.hour === h);
        if (!slot) continue;
        if (r.status === "in_progress") slot.in_progress += 1;
        else if (r.status === "late") slot.late += 1;
        else if (r.status === "final_check") slot.final_check += 1;
        else if (r.status === "scheduled") slot.scheduled += 1;
        // other statuses (on_hold, completed, awaiting_payment, ...) skipped — they're not "today's flow"
      }
      setData(counts);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const nowHour = new Date().getHours() + new Date().getMinutes() / 60;

  return (
    <SectionCard
      title="Today's Flow"
      subtitle={`Hour by hour · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
      actions={
        <>
          <Pill tone="ok">{STATUS_BAR_LABEL.scheduled}</Pill>
          <Pill tone="info">{STATUS_BAR_LABEL.in_progress}</Pill>
          <Pill tone="violet">{STATUS_BAR_LABEL.final_check}</Pill>
          <Pill tone="coral">{STATUS_BAR_LABEL.late}</Pill>
        </>
      }
    >
      <div className="h-48">
        {loading ? (
          <div className="h-full bg-fx-paper-2/40 rounded animate-pulse" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barCategoryGap={4} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="label"
                interval={1}
                tick={{ fontSize: 9, fill: "#6B6B85", fontFamily: "var(--font-mono)" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: "rgba(2,0,64,0.04)" }}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid var(--color-fx-line)",
                  boxShadow: "var(--shadow-fx-2)",
                }}
                labelFormatter={(v) => `${v}:00`}
                formatter={(value, name) => {
                  const key = String(name) as keyof typeof STATUS_BAR_LABEL;
                  return [value, STATUS_BAR_LABEL[key] ?? String(name)];
                }}
              />
              <Legend wrapperStyle={{ display: "none" }} />
              <ReferenceLine x={data[Math.max(0, Math.round(nowHour) - 7)]?.label} stroke="#0A0A1F" strokeDasharray="2 3" />
              <Bar dataKey="scheduled" stackId="a" fill={COLORS.scheduled} radius={[0, 0, 0, 0]} />
              <Bar dataKey="in_progress" stackId="a" fill={COLORS.in_progress} radius={[0, 0, 0, 0]} />
              <Bar dataKey="final_check" stackId="a" fill={COLORS.final_check} radius={[0, 0, 0, 0]} />
              <Bar dataKey="late" stackId="a" fill={COLORS.late} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </SectionCard>
  );
}
