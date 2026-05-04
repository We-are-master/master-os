"use client";

import { Repeat as RepeatIcon } from "lucide-react";
import { motion } from "framer-motion";
import {
  jobScheduleYmd,
  jobFinishYmd,
  formatScheduleCalendarBarTooltip,
} from "@/lib/schedule-calendar";
import { UK_TIMEZONE } from "@/lib/utils/date";
import {
  scheduleJobBarDoneVisually,
  scheduleJobNeedsAssignmentHighlight,
} from "@/lib/schedule-visible-jobs";
import {
  scheduleJobStatusColorClasses,
  formatScheduleCalendarBarCompact,
} from "@/lib/schedule-job-type-style";
import { cn } from "@/lib/utils";
import type { Job } from "@/types/database";

const HOUR_HEIGHT = 36;            // px per hour row
const HOURS_VISIBLE = 24;          // 0..24
const TIME_GUTTER_WIDTH = 56;      // px

const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK_TIMEZONE,
  weekday: "short",
  day: "numeric",
});

const DAY_FULL_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK_TIMEZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** YYYY-MM-DD in local time (matches schedule-calendar.ts). */
function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function compareYmd(a: { y: number; m: number; d: number }, b: { y: number; m: number; d: number }): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}

function ymdEquals(a: { y: number; m: number; d: number }, b: { y: number; m: number; d: number }): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

function dateToYmdParts(d: Date): { y: number; m: number; d: number } {
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

/** True if the job's [scheduled_date, scheduled_finish_date] range covers `target`. */
function jobIntersectsDay(job: Job, target: Date): boolean {
  const start = jobScheduleYmd(job);
  if (!start) return false;
  const finish = jobFinishYmd(job) ?? start;
  const t = dateToYmdParts(target);
  return compareYmd(start, t) <= 0 && compareYmd(finish, t) >= 0;
}

/** Hour-of-day fraction (e.g. 9.5 = 09:30) of a timestamp in UK local time. */
function localHourFraction(iso: string): number {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return 0;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(dt);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h + m / 60;
}

interface JobBlock {
  job: Job;
  topPx: number;
  heightPx: number;
}

/**
 * Build the time-block for a job within a specific day. Handles three cases:
 *   1. Single-day job (start_at + end_at on same day) → exact bar
 *   2. Multi-day job, target is FIRST day → start_at to 24:00
 *   3. Multi-day job, target is MIDDLE day → 0:00 to 24:00
 *   4. Multi-day job, target is LAST day → 0:00 to end_at
 *   5. No times set → fallback to a small placeholder bar at 9:00-17:00
 */
function blockForJobOnDay(job: Job, target: Date): JobBlock | null {
  const start = jobScheduleYmd(job);
  const finish = jobFinishYmd(job) ?? start;
  if (!start || !finish) return null;
  const t = dateToYmdParts(target);
  if (compareYmd(start, t) > 0 || compareYmd(finish, t) < 0) return null;

  const isFirstDay = ymdEquals(start, t);
  const isLastDay = ymdEquals(finish, t);

  let startHour = 0;
  let endHour = 24;

  if (isFirstDay && job.scheduled_start_at) {
    startHour = localHourFraction(job.scheduled_start_at);
  } else if (isFirstDay) {
    startHour = 9;
  }

  if (isLastDay && job.scheduled_end_at) {
    endHour = localHourFraction(job.scheduled_end_at);
  } else if (isLastDay && !isFirstDay) {
    endHour = 17;
  } else if (isLastDay) {
    // Single-day fallback when only start was set.
    endHour = job.scheduled_start_at ? Math.min(24, startHour + 2) : 17;
  }

  // Defensive clamp + minimum height of 0.5h.
  if (endHour <= startHour) endHour = Math.min(24, startHour + 0.5);
  startHour = Math.max(0, Math.min(HOURS_VISIBLE, startHour));
  endHour = Math.max(0, Math.min(HOURS_VISIBLE, endHour));

  return {
    job,
    topPx: startHour * HOUR_HEIGHT,
    heightPx: Math.max(HOUR_HEIGHT * 0.5, (endHour - startHour) * HOUR_HEIGHT),
  };
}

interface CommonProps {
  jobs: Job[];
  onSelectJob: (j: Job) => void;
  accountLogoByClientId: Map<string, string | null>;
}

// ─── Week view ──────────────────────────────────────────────────────────────

interface WeekProps extends CommonProps {
  /** Any date inside the week to display (Mon-Sun). */
  weekAnchor: Date;
}

/**
 * 7-column grid (Mon-Sun) × 24-hour rows.
 * Each job is rendered as an absolutely-positioned block in the column for the
 * day it falls on. Multi-day jobs render as separate blocks per day.
 */
export function WeekView({ jobs, onSelectJob, accountLogoByClientId, weekAnchor }: WeekProps) {
  // Compute Monday of the week containing weekAnchor.
  const anchorDow = weekAnchor.getDay(); // 0=Sun..6=Sat
  const daysFromMonday = (anchorDow + 6) % 7;
  const monday = new Date(weekAnchor);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - daysFromMonday);

  const days: Date[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  const today = new Date();
  const todayYmd = localYmd(today);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Day column headers */}
      <div className="flex shrink-0 border-b border-border-light">
        <div style={{ width: TIME_GUTTER_WIDTH }} className="shrink-0" />
        {days.map((d) => {
          const isToday = localYmd(d) === todayYmd;
          return (
            <div
              key={d.toISOString()}
              className={cn(
                "flex-1 px-2 py-1.5 text-center text-[11px] font-semibold",
                isToday ? "text-primary" : "text-text-tertiary",
              )}
            >
              <span className="uppercase tracking-wider">
                {DAY_LABEL_FORMATTER.format(d)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Scrollable time grid */}
      <div className="flex min-h-0 flex-1 overflow-auto">
        <div className="flex relative" style={{ minHeight: HOUR_HEIGHT * HOURS_VISIBLE }}>
          {/* Time gutter */}
          <div style={{ width: TIME_GUTTER_WIDTH }} className="shrink-0 border-r border-border-light bg-surface-hover/30">
            {Array.from({ length: HOURS_VISIBLE }, (_, h) => (
              <div
                key={h}
                style={{ height: HOUR_HEIGHT }}
                className="flex items-start justify-end pr-1.5 pt-0.5 text-[10px] text-text-tertiary tabular-nums"
              >
                {h.toString().padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((d) => {
            const blocks = jobs
              .filter((j) => jobIntersectsDay(j, d))
              .map((j) => blockForJobOnDay(j, d))
              .filter((b): b is JobBlock => b != null);
            const isToday = localYmd(d) === todayYmd;
            return (
              <div
                key={d.toISOString()}
                className={cn(
                  "relative flex-1 border-r border-border-light",
                  isToday && "bg-primary/[0.025]",
                )}
                style={{ height: HOUR_HEIGHT * HOURS_VISIBLE }}
              >
                {/* Hour grid lines */}
                {Array.from({ length: HOURS_VISIBLE }, (_, h) => (
                  <div
                    key={h}
                    style={{ height: HOUR_HEIGHT, top: h * HOUR_HEIGHT }}
                    className="absolute inset-x-0 border-b border-border-light/40"
                  />
                ))}
                {/* Jobs */}
                {blocks.map((b) => (
                  <JobBlockChip
                    key={`${b.job.id}-${d.toISOString()}`}
                    block={b}
                    onSelect={onSelectJob}
                    accountLogoUrl={
                      b.job.client_id ? accountLogoByClientId.get(b.job.client_id.trim()) ?? null : null
                    }
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Day view ──────────────────────────────────────────────────────────────

interface DayProps extends CommonProps {
  /** The day to display. */
  dayAnchor: Date;
}

export function DayView({ jobs, onSelectJob, accountLogoByClientId, dayAnchor }: DayProps) {
  const blocks = jobs
    .filter((j) => jobIntersectsDay(j, dayAnchor))
    .map((j) => blockForJobOnDay(j, dayAnchor))
    .filter((b): b is JobBlock => b != null);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border-light px-3 py-2 text-sm font-semibold text-text-primary">
        {DAY_FULL_FORMATTER.format(dayAnchor)}
        <span className="ml-2 text-[11px] font-normal text-text-tertiary">
          {blocks.length} job{blocks.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 overflow-auto">
        <div className="flex relative w-full" style={{ minHeight: HOUR_HEIGHT * HOURS_VISIBLE }}>
          {/* Time gutter */}
          <div style={{ width: TIME_GUTTER_WIDTH }} className="shrink-0 border-r border-border-light bg-surface-hover/30">
            {Array.from({ length: HOURS_VISIBLE }, (_, h) => (
              <div
                key={h}
                style={{ height: HOUR_HEIGHT }}
                className="flex items-start justify-end pr-1.5 pt-0.5 text-[10px] text-text-tertiary tabular-nums"
              >
                {h.toString().padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* Single column */}
          <div className="relative flex-1" style={{ height: HOUR_HEIGHT * HOURS_VISIBLE }}>
            {Array.from({ length: HOURS_VISIBLE }, (_, h) => (
              <div
                key={h}
                style={{ height: HOUR_HEIGHT, top: h * HOUR_HEIGHT }}
                className="absolute inset-x-0 border-b border-border-light/40"
              />
            ))}
            {blocks.map((b) => (
              <JobBlockChip
                key={b.job.id}
                block={b}
                onSelect={onSelectJob}
                accountLogoUrl={
                  b.job.client_id ? accountLogoByClientId.get(b.job.client_id.trim()) ?? null : null
                }
                wide
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Job block chip ─────────────────────────────────────────────────────────

function JobBlockChip({
  block, onSelect, accountLogoUrl, wide,
}: {
  block: JobBlock;
  onSelect: (j: Job) => void;
  accountLogoUrl: string | null;
  wide?: boolean;
}) {
  const job = block.job;
  const isRecurring = !!job.recurrence_series_id;
  return (
    <motion.div
      onClick={() => onSelect(job)}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      title={formatScheduleCalendarBarTooltip(job)}
      className={cn(
        "absolute left-1 right-1 cursor-pointer rounded-md border px-1.5 py-1 text-[10px] font-medium overflow-hidden",
        scheduleJobStatusColorClasses(job.status),
        scheduleJobBarDoneVisually(job) && "opacity-[0.68] line-through",
        scheduleJobNeedsAssignmentHighlight(job) &&
          "ring-2 ring-amber-500/85 ring-offset-1 ring-offset-card",
        wide && "px-2 py-1.5 text-[11px]",
      )}
      style={{ top: block.topPx, height: block.heightPx }}
    >
      <div className="flex items-center gap-1 min-w-0">
        {accountLogoUrl ? (
          <img
            src={accountLogoUrl}
            alt=""
            className="h-[12px] w-[12px] shrink-0 rounded-[2px] object-contain bg-white/80 ring-1 ring-black/[0.08]"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{formatScheduleCalendarBarCompact(job)}</span>
        {isRecurring ? (
          <RepeatIcon className="h-[10px] w-[10px] shrink-0 opacity-80" aria-label="Recurring series" />
        ) : null}
      </div>
    </motion.div>
  );
}
