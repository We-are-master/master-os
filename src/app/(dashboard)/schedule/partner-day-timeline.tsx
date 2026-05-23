"use client";

import { Repeat as RepeatIcon } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { UK_TIMEZONE } from "@/lib/utils/date";
import {
  jobScheduleYmd,
  jobFinishYmd,
  formatScheduleCalendarBarTooltip,
} from "@/lib/schedule-calendar";
import {
  scheduleJobBarDoneVisually,
  scheduleJobNeedsAssignmentHighlight,
} from "@/lib/schedule-visible-jobs";
import {
  scheduleJobStatusColorClasses,
  formatScheduleCalendarBarCompact,
} from "@/lib/schedule-job-type-style";
import { jobHasPartnerSet } from "@/lib/job-partner-assign";
import type { Job } from "@/types/database";

const UNASSIGNED_ROW_ID = "__unassigned__";

/** Visible window on the day timeline (local UK hours). */
const TIMELINE_START_HOUR = 6;
const TIMELINE_END_HOUR = 21;
const PARTNER_COL_WIDTH = 140;
const TIMELINE_SPAN_HOURS = TIMELINE_END_HOUR - TIMELINE_START_HOUR;
const ROW_BASE_HEIGHT = 52;
const LANE_HEIGHT = 26;

const DAY_FULL_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK_TIMEZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

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

function jobIntersectsDay(job: Job, target: Date): boolean {
  const start = jobScheduleYmd(job);
  if (!start) return false;
  const finish = jobFinishYmd(job) ?? start;
  const t = dateToYmdParts(target);
  return compareYmd(start, t) <= 0 && compareYmd(finish, t) >= 0;
}

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

function getJobDayHourRange(job: Job, target: Date): { startHour: number; endHour: number } | null {
  const start = jobScheduleYmd(job);
  const finish = jobFinishYmd(job) ?? start;
  if (!start || !finish) return null;
  const t = dateToYmdParts(target);
  if (compareYmd(start, t) > 0 || compareYmd(finish, t) < 0) return null;

  const isFirstDay = ymdEquals(start, t);
  const isLastDay = ymdEquals(finish, t);

  let startHour = TIMELINE_START_HOUR;
  let endHour = TIMELINE_END_HOUR;

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
    endHour = job.scheduled_start_at ? Math.min(TIMELINE_END_HOUR, startHour + 2) : 17;
  }

  if (endHour <= startHour) endHour = Math.min(TIMELINE_END_HOUR, startHour + 0.5);
  startHour = Math.max(TIMELINE_START_HOUR, Math.min(TIMELINE_END_HOUR, startHour));
  endHour = Math.max(TIMELINE_START_HOUR, Math.min(TIMELINE_END_HOUR, endHour));

  return { startHour, endHour };
}

export function jobAssignedToPartnerId(job: Job, partnerId: string): boolean {
  const pid = job.partner_id?.trim();
  if (pid === partnerId) return true;
  const ids = job.partner_ids;
  return Array.isArray(ids) && ids.some((x) => x != null && String(x).trim() === partnerId);
}

type TimelineBlock = {
  job: Job;
  startHour: number;
  endHour: number;
  lane: number;
};

function assignOverlapLanes(
  items: { startHour: number; endHour: number; job: Job }[],
): TimelineBlock[] {
  const sorted = [...items].sort((a, b) => a.startHour - b.startHour || a.endHour - b.endHour);
  const laneEnds: number[] = [];
  const out: TimelineBlock[] = [];
  for (const item of sorted) {
    let lane = 0;
    while (lane < laneEnds.length && laneEnds[lane] > item.startHour + 0.02) lane++;
    if (lane === laneEnds.length) laneEnds.push(item.endHour);
    else laneEnds[lane] = item.endHour;
    out.push({ ...item, lane });
  }
  return out;
}

function blocksForPartnerRow(jobs: Job[], dayAnchor: Date): TimelineBlock[] {
  const raw = jobs
    .filter((j) => jobIntersectsDay(j, dayAnchor))
    .map((j) => {
      const range = getJobDayHourRange(j, dayAnchor);
      if (!range) return null;
      return { job: j, ...range };
    })
    .filter((x): x is { job: Job; startHour: number; endHour: number } => x != null);
  return assignOverlapLanes(raw);
}

function formatHourLabel(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Map local hour to % along the fluid timeline track (06:00 = 0%, 21:00 = 100%). */
function hourToTimelinePercent(h: number): number {
  return ((h - TIMELINE_START_HOUR) / TIMELINE_SPAN_HOURS) * 100;
}

export type PartnerTimelineRow = { id: string; name: string };

export function PartnerDayTimelineView({
  jobs,
  dayAnchor,
  partnerRows,
  onSelectJob,
  accountLogoByClientId,
}: {
  jobs: Job[];
  dayAnchor: Date;
  partnerRows: PartnerTimelineRow[];
  onSelectJob: (j: Job) => void;
  accountLogoByClientId: Map<string, string | null>;
}) {
  const hourCount = TIMELINE_SPAN_HOURS;
  const today = new Date();
  const isToday = dayAnchor.toDateString() === today.toDateString();
  const nowHour = isToday ? localHourFraction(new Date().toISOString()) : null;

  const rowData = partnerRows.map((row) => {
    const rowJobs =
      row.id === UNASSIGNED_ROW_ID
        ? jobs.filter((j) => !jobHasPartnerSet(j))
        : jobs.filter((j) => jobAssignedToPartnerId(j, row.id));
    const blocks = blocksForPartnerRow(rowJobs, dayAnchor);
    const maxLane = blocks.reduce((m, b) => Math.max(m, b.lane), 0);
    const rowHeight = ROW_BASE_HEIGHT + maxLane * LANE_HEIGHT;
    return { row, blocks, rowHeight };
  });

  const totalJobs = rowData.reduce((n, r) => n + r.blocks.length, 0);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border-light px-3 py-2 text-sm font-semibold text-text-primary">
        {DAY_FULL_FORMATTER.format(dayAnchor)}
        <span className="ml-2 text-[11px] font-normal text-text-tertiary">
          Partner timeline · {totalJobs} job{totalJobs !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto overflow-x-hidden">
        {/* Hour headers — full width */}
        <div className="flex w-full sticky top-0 z-20 shrink-0 bg-card border-b border-border-light">
          <div
            style={{ width: PARTNER_COL_WIDTH }}
            className="shrink-0 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary border-r border-border-light"
          >
            Partner
          </div>
          <div className="flex flex-1 min-w-0">
            {Array.from({ length: hourCount }, (_, i) => {
              const h = TIMELINE_START_HOUR + i;
              return (
                <div
                  key={h}
                  className="flex-1 min-w-[2.25rem] border-r border-border-light/60 px-0.5 py-1.5 text-center text-[10px] font-medium text-text-tertiary tabular-nums"
                >
                  {formatHourLabel(h)}
                </div>
              );
            })}
          </div>
        </div>

        {/* Partner rows */}
        {rowData.length === 0 ? (
          <p className="px-4 py-8 text-sm text-text-tertiary">No partners to show.</p>
        ) : (
          rowData.map(({ row, blocks, rowHeight }) => (
            <div
              key={row.id}
              className="flex w-full border-b border-border-light/80 hover:bg-surface-hover/20"
              style={{ minHeight: rowHeight }}
            >
              <div
                style={{ width: PARTNER_COL_WIDTH, minHeight: rowHeight }}
                className="shrink-0 flex items-center gap-2 px-2 py-2 border-r border-border-light bg-surface-hover/25"
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                    row.id === UNASSIGNED_ROW_ID
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  {row.id === UNASSIGNED_ROW_ID ? "?" : initials(row.name)}
                </span>
                <span className="text-[11px] font-semibold text-text-primary leading-tight line-clamp-2 min-w-0">
                  {row.name}
                </span>
              </div>

              <div className="relative flex-1 min-w-0 bg-surface-hover/10" style={{ minHeight: rowHeight }}>
                {Array.from({ length: hourCount + 1 }, (_, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 border-l border-border-light/35 pointer-events-none"
                    style={{ left: `${(i / hourCount) * 100}%` }}
                    aria-hidden
                  />
                ))}

                {nowHour != null &&
                nowHour >= TIMELINE_START_HOUR &&
                nowHour <= TIMELINE_END_HOUR ? (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-primary z-10 pointer-events-none"
                    style={{ left: `${hourToTimelinePercent(nowHour)}%` }}
                    aria-hidden
                  />
                ) : null}

                {blocks.map((b) => {
                  const leftPct = hourToTimelinePercent(b.startHour);
                  const widthPct = Math.max(
                    1.5,
                    hourToTimelinePercent(b.endHour) - leftPct,
                  );
                  const top = 6 + b.lane * LANE_HEIGHT;
                  const logo = b.job.client_id
                    ? accountLogoByClientId.get(b.job.client_id.trim()) ?? null
                    : null;
                  return (
                    <TimelineJobChip
                      key={`${b.job.id}-${b.lane}`}
                      job={b.job}
                      leftPercent={leftPct}
                      widthPercent={widthPct}
                      top={top}
                      accountLogoUrl={logo}
                      onSelect={onSelectJob}
                    />
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TimelineJobChip({
  job,
  leftPercent,
  widthPercent,
  top,
  accountLogoUrl,
  onSelect,
}: {
  job: Job;
  leftPercent: number;
  widthPercent: number;
  top: number;
  accountLogoUrl: string | null;
  onSelect: (j: Job) => void;
}) {
  const isRecurring = !!job.recurrence_series_id;
  return (
    <motion.button
      type="button"
      onClick={() => onSelect(job)}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      title={formatScheduleCalendarBarTooltip(job)}
      className={cn(
        "absolute z-[2] flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-left text-[10px] font-medium overflow-hidden",
        scheduleJobStatusColorClasses(job.status),
        scheduleJobBarDoneVisually(job) && "opacity-[0.68] line-through",
        scheduleJobNeedsAssignmentHighlight(job) &&
          "ring-2 ring-amber-500/85 ring-offset-1 ring-offset-card",
      )}
      style={{
        left: `calc(${leftPercent}% + 2px)`,
        width: `max(2rem, calc(${widthPercent}% - 4px))`,
        top,
        height: LANE_HEIGHT - 4,
      }}
    >
      {accountLogoUrl ? (
        <img
          src={accountLogoUrl}
          alt=""
          className="h-3 w-3 shrink-0 rounded-[2px] object-contain bg-white/80 ring-1 ring-black/[0.08]"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{formatScheduleCalendarBarCompact(job)}</span>
      {isRecurring ? (
        <RepeatIcon className="h-[9px] w-[9px] shrink-0 opacity-80" aria-hidden />
      ) : null}
    </motion.button>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export { UNASSIGNED_ROW_ID };
