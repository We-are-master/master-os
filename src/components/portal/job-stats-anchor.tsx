"use client";

import { useEffect, useState } from "react";
import { Clock, Activity, CalendarClock, Gauge } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface JobStatsAnchorProps {
  currentPhase: number | null;
  totalPhases: number | null;
  scheduledStartAt: string | null;
  scheduledFinishDate: string | null;
  partnerTimerStartedAt: string | null;
  partnerTimerEndedAt: string | null;
  partnerTimerAccumPausedMs: number | null;
  partnerTimerIsPaused: boolean | null;
  partnerTimerPauseBeganAt: string | null;
  status: string;
}

function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalMins = Math.floor(ms / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function nextMilestone(status: string, scheduledStartAt: string | null, scheduledFinishDate: string | null): string {
  if (status === "scheduled" || status === "unassigned" || status === "auto_assigning" || status === "late") {
    if (scheduledStartAt) {
      return `Starts ${new Date(scheduledStartAt).toLocaleString("en-GB", {
        weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      })}`;
    }
    return "Awaiting schedule";
  }
  if (status.startsWith("in_progress")) {
    if (scheduledFinishDate) {
      return `Due ${new Date(scheduledFinishDate).toLocaleDateString("en-GB", {
        weekday: "short", day: "2-digit", month: "short",
      })}`;
    }
    return "On site";
  }
  if (status === "final_check") return "Final QA in progress";
  if (status === "awaiting_payment") return "Awaiting payment";
  if (status === "completed") return "Job complete";
  if (status === "on_hold") return "Paused — we'll be in touch";
  if (status === "cancelled") return "Cancelled";
  return "—";
}

/**
 * Computes the partner's ON-SITE elapsed time.
 *
 * Clock math mirrors `src/lib/office-job-timer.ts` to stay consistent:
 *   elapsed = (endedAt || now) - startedAt - accumPausedMs - currentPauseDelta
 *
 * If the job is currently paused, the "currentPauseDelta" is wall-clock
 * since pause began — it ticks so the UI stays live without re-fetching.
 */
function computeElapsedMs(args: {
  start: string | null;
  end: string | null;
  accumPausedMs: number | null;
  isPaused: boolean | null;
  pauseBeganAt: string | null;
  nowMs: number;
}): number | null {
  if (!args.start) return null;
  const startMs = Date.parse(args.start);
  if (!Number.isFinite(startMs)) return null;
  const endMs = args.end ? Date.parse(args.end) : args.nowMs;
  const accum = args.accumPausedMs ?? 0;
  const currentPause =
    args.isPaused && args.pauseBeganAt
      ? Math.max(0, args.nowMs - Date.parse(args.pauseBeganAt))
      : 0;
  return Math.max(0, endMs - startMs - accum - currentPause);
}

export function JobStatsAnchor({
  currentPhase,
  totalPhases,
  scheduledStartAt,
  scheduledFinishDate,
  partnerTimerStartedAt,
  partnerTimerEndedAt,
  partnerTimerAccumPausedMs,
  partnerTimerIsPaused,
  partnerTimerPauseBeganAt,
  status,
}: JobStatsAnchorProps) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const timerLive = !!partnerTimerStartedAt && !partnerTimerEndedAt;

  useEffect(() => {
    if (!timerLive) return;
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [timerLive]);

  const elapsed = computeElapsedMs({
    start: partnerTimerStartedAt,
    end: partnerTimerEndedAt,
    accumPausedMs: partnerTimerAccumPausedMs,
    isPaused: partnerTimerIsPaused,
    pauseBeganAt: partnerTimerPauseBeganAt,
    nowMs,
  });

  const total = Math.max(1, totalPhases ?? 2);
  const phase = Math.max(0, Math.min(total, currentPhase ?? 0));
  const pct = Math.round((phase / total) * 100);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Cell
        icon={Activity}
        label="Status"
        value={statusLabel(status)}
        caption={status === "on_hold" ? "Paused" : undefined}
      />
      <Cell
        icon={Gauge}
        label="Progress"
        value={`${pct}%`}
        caption={`Phase ${phase} of ${total}`}
      />
      <Cell
        icon={Clock}
        label="Time on site"
        value={elapsed != null ? fmtDuration(elapsed) : "—"}
        caption={
          timerLive
            ? partnerTimerIsPaused
              ? "Paused"
              : "Running"
            : elapsed != null
              ? "Final"
              : "Not started"
        }
        pulse={timerLive && !partnerTimerIsPaused}
      />
      <Cell
        icon={CalendarClock}
        label="Next milestone"
        value={nextMilestone(status, scheduledStartAt, scheduledFinishDate)}
      />
    </div>
  );
}

function statusLabel(s: string): string {
  if (s.startsWith("in_progress")) return "In progress";
  if (s === "unassigned" || s === "auto_assigning") return "Pending";
  if (s === "final_check") return "Final check";
  if (s === "awaiting_payment") return "Awaiting pay";
  if (s === "need_attention") return "Needs review";
  if (s === "on_hold") return "On hold";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface CellProps {
  icon: IconComponent;
  label: string;
  value: string;
  caption?: string;
  pulse?: boolean;
}
function Cell({ icon: Icon, label, value, caption, pulse }: CellProps) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="flex items-center gap-2">
        <p className="text-xl font-black text-text-primary tabular-nums leading-none">{value}</p>
        {pulse && (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
        )}
      </div>
      {caption && <p className="text-[11px] text-text-tertiary mt-1">{caption}</p>}
    </div>
  );
}
