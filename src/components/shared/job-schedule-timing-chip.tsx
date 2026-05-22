"use client";

import { cn } from "@/lib/utils";
import { isJobOverdue, type JobOverdueInput } from "@/lib/job-overdue";
import { formatJobScheduleLine, jobScheduleYmd } from "@/lib/schedule-calendar";
import { UK_TIMEZONE } from "@/lib/utils/date";

export type JobScheduleTimingKind = "today" | "tomorrow" | "in_2_days";

export type JobScheduleTimingInput = JobOverdueInput;

const TIMING_CHIP_STATUSES = new Set([
  "unassigned",
  "auto_assigning",
  "scheduled",
]);

function isoCalendarDateInUk(isoOrDate: string | Date): string | null {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: UK_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function jobScheduleStartYmdUk(job: JobScheduleTimingInput): string | null {
  const p = jobScheduleYmd(job);
  if (!p) return null;
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

/** Same rules as Jobs Management schedule column — Today / Tomorrow / In 2 days. */
export function getJobScheduleTimingKind(job: JobScheduleTimingInput): JobScheduleTimingKind | null {
  if (!TIMING_CHIP_STATUSES.has(String(job.status))) return null;
  if (isJobOverdue(job)) return null;

  const scheduleYmd = jobScheduleStartYmdUk(job);
  if (!scheduleYmd) return null;

  const todayYmd = isoCalendarDateInUk(new Date());
  if (!todayYmd) return null;

  if (scheduleYmd === todayYmd) return "today";
  if (scheduleYmd === addDaysYmd(todayYmd, 1)) return "tomorrow";
  if (scheduleYmd === addDaysYmd(todayYmd, 2)) return "in_2_days";
  return null;
}

const CHIP_LABEL: Record<JobScheduleTimingKind, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  in_2_days: "In 2 days",
};

const CHIP_CLASS: Record<JobScheduleTimingKind, string> = {
  today:
    "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950/30 dark:text-red-300",
  tomorrow:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
  in_2_days:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
};

type Props = {
  job: JobScheduleTimingInput;
  /** Tooltip — defaults to full schedule line. */
  title?: string | null;
  className?: string;
};

/** Pill beside status in job header / jobs list when visit is today, tomorrow, or in two days. */
export function JobScheduleTimingChip({ job, title, className }: Props) {
  const kind = getJobScheduleTimingKind(job);
  if (!kind) return null;

  const tooltip = title === undefined ? formatJobScheduleLine(job) : title;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        CHIP_CLASS[kind],
        className,
      )}
      title={tooltip ?? undefined}
    >
      {CHIP_LABEL[kind]}
    </span>
  );
}
