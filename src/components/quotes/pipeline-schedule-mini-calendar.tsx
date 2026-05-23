"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, ChevronDown, Repeat as RepeatIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { getSupabase } from "@/services/base";
import type { Job } from "@/types/database";
import {
  fetchScheduleCalendarJobsForMonth,
  fetchScheduleCalendarJobsForYear,
  fetchScheduleCalendarJobsForWeekAnchor,
  fetchScheduleCalendarJobsForDayAnchor,
} from "@/lib/fetch-schedule-calendar-jobs";
import { jobVisibleOnSchedule } from "@/services/jobs";
import { listPartners } from "@/services/partners";
import {
  formatScheduleCalendarBarTooltip,
  jobFinishYmd,
  jobIntersectsLocalMonth,
  jobScheduleYmd,
} from "@/lib/schedule-calendar";
import {
  formatScheduleCalendarBarCompact,
  scheduleJobStatusColorClasses,
} from "@/lib/schedule-job-type-style";
import { scheduleJobBarDoneVisually, scheduleJobNeedsAssignmentHighlight } from "@/lib/schedule-visible-jobs";
import { jobHasPartnerSet } from "@/lib/job-partner-assign";
import { isPartnerEligibleForWork } from "@/lib/partner-status";
import { batchResolveClientAccountLogoUrls } from "@/lib/client-linked-account-label";
import { WeekView } from "@/app/(dashboard)/schedule/calendar-time-grid";
import {
  PartnerDayTimelineView,
  UNASSIGNED_ROW_ID,
  jobAssignedToPartnerId,
  type PartnerTimelineRow,
} from "@/app/(dashboard)/schedule/partner-day-timeline";

/** Match Live View month bars (multi-day strip segments). */
type ScheduleBarSegment = "only" | "first" | "middle" | "last";

export type PipelineCalendarView = "year" | "month" | "week" | "day";

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DAYS_OF_WEEK_SHORT = ["M", "T", "W", "T", "F", "S", "S"] as const;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const MAX_JOBS_VISIBLE_PER_CELL = 10;

function formatWeekRangeLabel(anchor: Date): string {
  const dow = (anchor.getDay() + 6) % 7;
  const monday = new Date(anchor);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - dow);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "short" });
  const sameMonth = monday.getMonth() === sunday.getMonth();
  const sameYear = monday.getFullYear() === sunday.getFullYear();
  const left = sameMonth
    ? `${monday.getDate()}`
    : `${monday.getDate()} ${monthFmt.format(monday)}${sameYear ? "" : ` ${monday.getFullYear()}`}`;
  const right = `${sunday.getDate()} ${monthFmt.format(sunday)} ${sunday.getFullYear()}`;
  return `${left} – ${right}`;
}

function formatDayLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

function startMondayLocal(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}

function jobTouchesCalendarYear(job: Job, y: number): boolean {
  for (let m = 0; m < 12; m++) {
    if (jobIntersectsLocalMonth(job, y, m)) return true;
  }
  return false;
}

function jobOverlapsLocalWeek(job: Job, weekAnchor: Date): boolean {
  const mon = startMondayLocal(weekAnchor);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  const fromMs = mon.getTime();
  const toMs = sun.getTime();
  const s = jobScheduleYmd(job);
  if (!s) return false;
  const e = jobFinishYmd(job) ?? s;
  const js = new Date(s.y, s.m - 1, s.d).getTime();
  const je = new Date(e.y, e.m - 1, e.d).getTime();
  return !(je < fromMs || js > toMs);
}

function jobOverlapsLocalDay(job: Job, dayAnchor: Date): boolean {
  const x = new Date(dayAnchor);
  x.setHours(0, 0, 0, 0);
  const fromMs = x.getTime();
  const end = new Date(x);
  end.setHours(23, 59, 59, 999);
  const toMs = end.getTime();
  const s = jobScheduleYmd(job);
  if (!s) return false;
  const e = jobFinishYmd(job) ?? s;
  const js = new Date(s.y, s.m - 1, s.d).getTime();
  const je = new Date(e.y, e.m - 1, e.d).getTime();
  return !(je < fromMs || js > toMs);
}

function scheduleBarSegment(
  job: Job,
  dayGridIndex: number,
  calendarDays: (number | null)[],
  jobDaysInMonth: Map<string, Set<number>>,
): ScheduleBarSegment {
  const days = jobDaysInMonth.get(job.id);
  if (!days || days.size <= 1) return "only";
  const hasOn = (cell: number | null | undefined) => typeof cell === "number" && days.has(cell);
  let left = false;
  let right = false;
  if (dayGridIndex > 0) left = hasOn(calendarDays[dayGridIndex - 1]);
  if (dayGridIndex < calendarDays.length - 1) right = hasOn(calendarDays[dayGridIndex + 1]);
  if (!left && !right) return "only";
  if (!left && right) return "first";
  if (left && right) return "middle";
  return "last";
}

function scheduleBarSegmentClass(segment: ScheduleBarSegment, colorClasses: string): string {
  const base = cn(
    "flex w-full min-w-0 items-center px-1.5 py-[3px] text-[10px] font-semibold leading-snug border cursor-pointer hover:opacity-90 transition-opacity sm:text-[11px]",
    colorClasses,
  );
  switch (segment) {
    case "only":
      return `${base} rounded-md`;
    case "first":
      return `${base} rounded-l-md rounded-r-none border-r-0 -mr-px`;
    case "middle":
      return `${base} rounded-none border-x-0 -mx-px`;
    case "last":
      return `${base} rounded-r-md rounded-l-none border-l-0 -ml-px`;
    default:
      return `${base} rounded-md`;
  }
}

function jobCalendarSortKey(job: Job): string {
  const start = jobScheduleYmd(job);
  const prefix = start
    ? `${start.y}-${String(start.m).padStart(2, "0")}-${String(start.d).padStart(2, "0")}`
    : "";
  return `${prefix}\0${job.title}\0${job.id}`;
}

function navigateJobRoute(job: Job, router: ReturnType<typeof useRouter>): void {
  const visitParentId = (job as Job & { __visit_parent_id?: string }).__visit_parent_id?.trim();
  if (visitParentId) router.push(`/jobs/${visitParentId}`);
  else router.push(`/jobs/${job.id}`);
}

function mondayStamp(d: Date): string {
  const m = startMondayLocal(d);
  return `${m.getFullYear()}-${m.getMonth()}-${m.getDate()}`;
}

interface PipelineScheduleMiniCalendarProps {
  hideCardTitle?: boolean;
  className?: string;
}

/**
 * Pipeline schedule (Operations → Schedule): Year / Month / Week / Day, same styling as Live View month grid where applicable.
 */
export function PipelineScheduleMiniCalendar({
  hideCardTitle = false,
  className,
}: PipelineScheduleMiniCalendarProps) {
  const router = useRouter();
  const [calendarView, setCalendarView] = useState<PipelineCalendarView>("month");
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());
  const [dayCursor, setDayCursor] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [schedulePartnerFilter, setSchedulePartnerFilter] = useState<"all" | "__unassigned__" | string>("all");
  const [activePartnerPicklist, setActivePartnerPicklist] = useState<{ id: string; name: string }[]>([]);
  const [accountLogoByClientId, setAccountLogoByClientId] = useState<Map<string, string | null>>(
    () => new Map(),
  );

  useEffect(() => {
    let cancelled = false;
    void listPartners({ pageSize: 500, status: "active" })
      .then((res) => {
        if (cancelled) return;
        const opts = (res.data ?? [])
          .filter(isPartnerEligibleForWork)
          .map((p) => ({
            id: p.id,
            name: (p.company_name ?? p.contact_name ?? "").trim() || "Partner",
          }))
          .filter((row) => row.id)
          .sort((a, b) => a.name.localeCompare(b.name));
        setActivePartnerPicklist(opts);
      })
      .catch(() => {
        if (!cancelled) setActivePartnerPicklist([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      let list: Job[];
      switch (calendarView) {
        case "year":
          list = await fetchScheduleCalendarJobsForYear(year);
          break;
        case "month":
          list = await fetchScheduleCalendarJobsForMonth(year, month);
          break;
        case "week":
          list = await fetchScheduleCalendarJobsForWeekAnchor(dayCursor);
          break;
        case "day":
          list = await fetchScheduleCalendarJobsForDayAnchor(dayCursor);
          break;
        default:
          list = [];
      }
      setJobs(list);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [calendarView, year, month, dayCursor]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void loadJobs();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loadJobs]);

  const pipelineJobs = useMemo(() => jobs.filter((j) => jobVisibleOnSchedule(j)), [jobs]);

  const displayedJobs = useMemo(() => {
    if (schedulePartnerFilter === "all") return pipelineJobs;
    if (schedulePartnerFilter === "__unassigned__") {
      return pipelineJobs.filter((j) => !jobHasPartnerSet(j));
    }
    return pipelineJobs.filter((j) => jobAssignedToPartnerId(j, schedulePartnerFilter));
  }, [pipelineJobs, schedulePartnerFilter]);

  useEffect(() => {
    const ids = [...new Set(pipelineJobs.map((j) => j.client_id).filter(Boolean))] as string[];
    if (ids.length === 0) {
      setAccountLogoByClientId(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const supabase = getSupabase();
      const map = await batchResolveClientAccountLogoUrls(supabase, ids);
      if (!cancelled) setAccountLogoByClientId(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [pipelineJobs]);

  const onSelectJob = useCallback((j: Job) => navigateJobRoute(j, router), [router]);

  /** Header label centre */
  const rangeLabel = useMemo(() => {
    if (calendarView === "year") return `${year}`;
    if (calendarView === "month") return `${MONTH_NAMES[month]} ${year}`;
    if (calendarView === "week") return formatWeekRangeLabel(dayCursor);
    return formatDayLabel(dayCursor);
  }, [calendarView, year, month, dayCursor]);

  const calendarNow = new Date();
  const isAnchorToday =
    calendarView === "year"
      ? year === calendarNow.getFullYear()
      : calendarView === "month"
        ? year === calendarNow.getFullYear() && month === calendarNow.getMonth()
        : calendarView === "week"
          ? mondayStamp(dayCursor) === mondayStamp(calendarNow)
          : dayCursor.toDateString() === calendarNow.toDateString();

  const visibleCountLabel = useMemo(() => {
    if (calendarView === "year") return displayedJobs.filter((j) => jobTouchesCalendarYear(j, year)).length;
    if (calendarView === "month")
      return displayedJobs.filter((j) => jobIntersectsLocalMonth(j, year, month)).length;
    if (calendarView === "week") return displayedJobs.filter((j) => jobOverlapsLocalWeek(j, dayCursor)).length;
    return displayedJobs.filter((j) => jobOverlapsLocalDay(j, dayCursor)).length;
  }, [displayedJobs, calendarView, year, month, dayCursor]);

  const goToday = () => {
    const t = new Date();
    setYear(t.getFullYear());
    setMonth(t.getMonth());
    const dc = new Date(t);
    dc.setHours(0, 0, 0, 0);
    setDayCursor(dc);
  };

  const goPrev = () => {
    if (calendarView === "year") setYear((y) => y - 1);
    else if (calendarView === "month") {
      if (month === 0) {
        setMonth(11);
        setYear((y) => y - 1);
      } else setMonth(month - 1);
    } else if (calendarView === "week") {
      const n = new Date(dayCursor);
      n.setDate(n.getDate() - 7);
      setDayCursor(n);
      setYear(n.getFullYear());
      setMonth(n.getMonth());
    } else {
      const n = new Date(dayCursor);
      n.setDate(n.getDate() - 1);
      setDayCursor(n);
      setYear(n.getFullYear());
      setMonth(n.getMonth());
    }
  };

  const goNext = () => {
    if (calendarView === "year") setYear((y) => y + 1);
    else if (calendarView === "month") {
      if (month === 11) {
        setMonth(0);
        setYear((y) => y + 1);
      } else setMonth(month + 1);
    } else if (calendarView === "week") {
      const n = new Date(dayCursor);
      n.setDate(n.getDate() + 7);
      setDayCursor(n);
      setYear(n.getFullYear());
      setMonth(n.getMonth());
    } else {
      const n = new Date(dayCursor);
      n.setDate(n.getDate() + 1);
      setDayCursor(n);
      setYear(n.getFullYear());
      setMonth(n.getMonth());
    }
  };

  const todayDate = calendarNow.getDate();
  const isSameMonthToday = year === calendarNow.getFullYear() && month === calendarNow.getMonth();

  const daysInMonthCalc = useMemo(() => new Date(year, month + 1, 0).getDate(), [year, month]);
  const firstDayOfWeekCalc = useMemo(() => (new Date(year, month, 1).getDay() + 6) % 7, [year, month]);

  const calendarDays: (number | null)[] = useMemo(() => {
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDayOfWeekCalc; i++) days.push(null);
    for (let i = 1; i <= daysInMonthCalc; i++) days.push(i);
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [firstDayOfWeekCalc, daysInMonthCalc]);

  const calendarWeekRowCount = Math.max(1, calendarDays.length / 7);

  const jobsByDay = useMemo(() => {
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    const jobDaysInMonth = new Map<string, Set<number>>();
    for (const job of displayedJobs) {
      if (!jobIntersectsLocalMonth(job, year, month)) continue;
      const start = jobScheduleYmd(job);
      if (!start) continue;
      const finish = jobFinishYmd(job) ?? start;
      const s = new Date(start.y, start.m - 1, start.d);
      const e = new Date(finish.y, finish.m - 1, finish.d);
      const set = new Set<number>();
      const c = new Date(Math.max(s.getTime(), monthStart.getTime()));
      const endClamp = new Date(Math.min(e.getTime(), monthEnd.getTime()));
      while (c <= endClamp) {
        if (c.getFullYear() === year && c.getMonth() === month) set.add(c.getDate());
        c.setDate(c.getDate() + 1);
      }
      if (set.size) jobDaysInMonth.set(job.id, set);
    }

    const map: Record<number, Array<{ job: Job; segment: ScheduleBarSegment }>> = {};
    for (const job of displayedJobs) {
      const days = jobDaysInMonth.get(job.id);
      if (!days) continue;
      for (const d of days) {
        const dayIndex = calendarDays.findIndex((cell) => cell === d);
        if (dayIndex < 0) continue;
        if (!map[d]) map[d] = [];
        map[d].push({
          job,
          segment: scheduleBarSegment(job, dayIndex, calendarDays, jobDaysInMonth),
        });
      }
    }
    for (const k of Object.keys(map)) {
      map[Number(k)].sort((a, b) => jobCalendarSortKey(a.job).localeCompare(jobCalendarSortKey(b.job)));
    }
    return map;
  }, [displayedJobs, year, month, calendarDays]);

  const pipelineForTimeGrids = useMemo(() => {
    return displayedJobs.filter((j) => {
      if (calendarView !== "week" && calendarView !== "day") return true;
      return calendarView === "week"
        ? jobOverlapsLocalWeek(j, dayCursor)
        : jobOverlapsLocalDay(j, dayCursor);
    });
  }, [displayedJobs, calendarView, dayCursor]);

  const dayTimelinePartnerRows = useMemo((): PartnerTimelineRow[] => {
    if (schedulePartnerFilter === "__unassigned__") {
      return [{ id: UNASSIGNED_ROW_ID, name: "Unassigned" }];
    }
    if (schedulePartnerFilter !== "all") {
      const name =
        activePartnerPicklist.find((p) => p.id === schedulePartnerFilter)?.name ?? "Partner";
      return [{ id: schedulePartnerFilter, name }];
    }
    return [{ id: UNASSIGNED_ROW_ID, name: "Unassigned" }, ...activePartnerPicklist];
  }, [schedulePartnerFilter, activePartnerPicklist]);

  const openDayFromYearGrid = useCallback((y: number, mIdx: number, dom: number) => {
    const d = new Date(y, mIdx, dom);
    d.setHours(0, 0, 0, 0);
    setDayCursor(d);
    setYear(y);
    setMonth(mIdx);
    setCalendarView("day");
  }, []);

  return (
    <Card
      padding="none"
      className={cn(
        "w-full overflow-hidden border-border-light shadow-soft flex flex-col min-h-0",
        className,
      )}
    >
      <div className="flex flex-col gap-2 border-b border-border-light bg-gradient-to-br from-card via-card to-primary/[0.03] px-3 py-2.5 sm:px-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          {!hideCardTitle ? (
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-text-primary sm:text-base">Schedule</h2>
                <span className="text-[11px] text-text-tertiary hidden sm:inline">Pipeline · action required → final checks</span>
              </div>
              <Tabs
                tabs={[
                  { id: "year", label: "Year" },
                  { id: "month", label: "Month" },
                  { id: "week", label: "Week" },
                  { id: "day", label: "Day" },
                ]}
                activeTab={calendarView}
                onChange={(id) => setCalendarView(id as PipelineCalendarView)}
                variant="pills"
              />
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Tabs
                tabs={[
                  { id: "year", label: "Year" },
                  { id: "month", label: "Month" },
                  { id: "week", label: "Week" },
                  { id: "day", label: "Day" },
                ]}
                activeTab={calendarView}
                onChange={(id) => setCalendarView(id as PipelineCalendarView)}
                variant="pills"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={goPrev}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-tertiary"
                aria-label="Previous period"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[11rem] text-center text-sm font-semibold text-text-primary tabular-nums sm:min-w-[14rem]">
                {rangeLabel}
              </span>
              <button
                type="button"
                onClick={goNext}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-tertiary"
                aria-label="Next period"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            {!isAnchorToday && (
              <Button variant="outline" size="sm" type="button" onClick={goToday} className="h-8 text-xs">
                Today
              </Button>
            )}
            <div className="relative min-w-[10rem] sm:min-w-[12.5rem]">
              <label htmlFor="schedule-partner-filter" className="sr-only">
                Filter by partner
              </label>
              <select
                id="schedule-partner-filter"
                aria-label="Filter schedule by partner"
                value={schedulePartnerFilter}
                onChange={(e) => setSchedulePartnerFilter(e.target.value)}
                className="h-8 w-full appearance-none rounded-lg border border-border-light bg-card py-1 pl-2.5 pr-8 text-xs font-medium text-text-primary outline-none ring-offset-card focus-visible:ring-2 focus-visible:ring-primary/25"
              >
                <option value="all">All partners</option>
                <option value="__unassigned__">Unassigned only</option>
                {activePartnerPicklist.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary"
                aria-hidden
              />
            </div>
            {loading ? (
              <span className="text-[11px] text-text-tertiary animate-pulse">Loading…</span>
            ) : (
              <span className="text-[11px] text-text-tertiary whitespace-nowrap">
                {visibleCountLabel} job{visibleCountLabel === 1 ? "" : "s"} visible
              </span>
            )}
          </div>
        </div>
      </div>

      {calendarView === "year" ? (
        <div className="max-h-[min(70vh,840px)] overflow-auto p-3 sm:p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {MONTH_NAMES.map((name, mi) => {
              const fd = (new Date(year, mi, 1).getDay() + 6) % 7;
              const dim = new Date(year, mi + 1, 0).getDate();
              const cells: (number | null)[] = [];
              for (let i = 0; i < fd; i++) cells.push(null);
              for (let d = 1; d <= dim; d++) cells.push(d);

              const dayCounts = (() => {
                const cmap = new Map<number, number>();
                for (const job of displayedJobs) {
                  if (!jobIntersectsLocalMonth(job, year, mi)) continue;
                  const start = jobScheduleYmd(job);
                  if (!start) continue;
                  const finish = jobFinishYmd(job) ?? start;
                  const ms = new Date(year, mi, 1);
                  const me = new Date(year, mi + 1, 0);
                  const s = new Date(start.y, start.m - 1, start.d);
                  const e = new Date(finish.y, finish.m - 1, finish.d);
                  const c = new Date(Math.max(s.getTime(), ms.getTime()));
                  const ec = new Date(Math.min(e.getTime(), me.getTime()));
                  while (c <= ec) {
                    if (c.getFullYear() === year && c.getMonth() === mi) {
                      const dom = c.getDate();
                      cmap.set(dom, (cmap.get(dom) ?? 0) + 1);
                    }
                    c.setDate(c.getDate() + 1);
                  }
                }
                return cmap;
              })();

              return (
                <div key={name} className="rounded-xl border border-border-light bg-card/80 p-2 shadow-sm">
                  <p className="mb-2 text-center text-[11px] font-semibold text-text-secondary">{name}</p>
                  <div className="grid grid-cols-7 gap-px text-[9px] text-text-tertiary">
                    {DAYS_OF_WEEK_SHORT.map((d) => (
                      <span key={`${mi}-${d}`} className="text-center font-semibold uppercase opacity-75">
                        {d}
                      </span>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-px">
                    {cells.map((dom, ix) =>
                      dom == null ? (
                        <span key={`e-${mi}-${ix}`} className="h-7" />
                      ) : (
                        <button
                          key={`${mi}-${dom}`}
                          type="button"
                          onClick={() => openDayFromYearGrid(year, mi, dom)}
                          className={cn(
                            "flex h-7 flex-col items-center justify-center rounded-md text-[10px] font-medium transition-colors hover:bg-primary/10",
                            year === calendarNow.getFullYear() &&
                              mi === calendarNow.getMonth() &&
                              dom === todayDate
                              ? "bg-primary text-white hover:bg-primary/90"
                              : "text-text-secondary",
                          )}
                          title={`${dom} · ${dayCounts.get(dom) ?? 0} jobs — open Day view`}
                        >
                          <span>{dom}</span>
                          {(dayCounts.get(dom) ?? 0) > 0 ? (
                            <span className="font-bold tabular-nums text-[8px] leading-none text-primary">
                              {dayCounts.get(dom)! > 99 ? "99+" : dayCounts.get(dom)}
                            </span>
                          ) : (
                            <span className="h-2" aria-hidden />
                          )}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : calendarView === "month" ? (
        <div className="-mx-px overflow-x-auto sm:mx-0">
          <div className="min-w-[600px] sm:min-w-0">
            <div className="grid shrink-0 grid-cols-7 border-b border-border-light bg-surface-secondary/35">
              {DAYS_OF_WEEK.map((day) => (
                <div
                  key={day}
                  className="px-0.5 py-1 text-center text-[10px] font-semibold uppercase tracking-wider text-text-tertiary sm:px-2 sm:py-1.5 sm:text-[11px]"
                >
                  {day}
                </div>
              ))}
            </div>

            <div
              className="grid grid-cols-7"
              style={{
                gridTemplateRows: `repeat(${calendarWeekRowCount}, minmax(5.5rem, auto))`,
              }}
            >
              {calendarDays.map((day, index) => {
                const dayJobs = day ? (jobsByDay[day] || []) : [];
                const isTodayCell = isSameMonthToday && day === todayDate;
                return (
                  <div
                    key={index}
                    className={cn(
                      "flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-r border-border-light p-1 sm:p-1.5",
                      isTodayCell ? "bg-primary/[0.06]" : day ? "hover:bg-surface-hover/30" : "bg-surface-hover/15",
                    )}
                  >
                    {day ? (
                      <>
                        <div className="mb-0.5 flex shrink-0 items-center justify-between px-0.5">
                          <button
                            type="button"
                            onClick={() => openDayFromYearGrid(year, month, day)}
                            className={cn(
                              "text-[11px] font-medium sm:text-xs",
                              isTodayCell
                                ? "flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-white sm:h-6 sm:w-6"
                                : "rounded-md px-0.5 text-text-secondary hover:bg-surface-hover/80",
                            )}
                            title="Open Day view"
                          >
                            {day}
                          </button>
                          {dayJobs.length > 0 && (
                            <span className="text-[10px] font-medium tabular-nums text-text-tertiary">{dayJobs.length}</span>
                          )}
                        </div>
                        <div className="min-h-0 flex-1 space-y-0.5 overflow-hidden min-w-0">
                          {dayJobs.slice(0, MAX_JOBS_VISIBLE_PER_CELL).map(({ job, segment }, idx) => {
                            const cid = job.client_id?.trim();
                            const accountLogoUrl = cid ? accountLogoByClientId.get(cid) : null;
                            const isRecurring = !!job.recurrence_series_id;
                            const visitParentId = (job as Job & { __visit_parent_id?: string }).__visit_parent_id;
                            const isVisit = !!visitParentId;
                            return (
                              <motion.div
                                key={`${job.id}-${day}-${segment}-${idx}`}
                                whileHover={{ scale: 1.01 }}
                                whileTap={{ scale: 0.99 }}
                                onClick={() =>
                                  isVisit ? router.push(`/jobs/${visitParentId}`) : router.push(`/jobs/${job.id}`)
                                }
                                title={formatScheduleCalendarBarTooltip(job)}
                                className={cn(
                                  scheduleBarSegmentClass(segment, scheduleJobStatusColorClasses(job.status)),
                                  scheduleJobBarDoneVisually(job) &&
                                    "opacity-[0.68] line-through decoration-text-current/90",
                                  scheduleJobNeedsAssignmentHighlight(job) &&
                                    "ring-2 ring-amber-500/80 ring-offset-1 ring-offset-card shadow-sm",
                                )}
                              >
                                <span className="flex min-w-0 flex-1 items-center gap-0.5">
                                  {accountLogoUrl ? (
                                    <img
                                      src={accountLogoUrl}
                                      alt=""
                                      className="h-3 w-3 shrink-0 rounded-[2px] object-contain bg-white/80 ring-1 ring-black/[0.08] sm:h-[11px] sm:w-[11px]"
                                      loading="lazy"
                                      referrerPolicy="no-referrer"
                                    />
                                  ) : null}
                                  <span className="min-w-0 flex-1 truncate">{formatScheduleCalendarBarCompact(job)}</span>
                                  {isVisit ? (
                                    <span
                                      className="shrink-0 rounded-sm bg-current/10 px-0.5 text-[8px] font-bold uppercase tracking-wider opacity-90"
                                      aria-label="Visit"
                                    >
                                      V{(job as Job & { __visit_index?: number }).__visit_index ?? ""}
                                    </span>
                                  ) : null}
                                  {isRecurring ? (
                                    <RepeatIcon className="h-[10px] w-[10px] shrink-0 opacity-80" aria-label="Recurring" />
                                  ) : null}
                                </span>
                              </motion.div>
                            );
                          })}
                          {dayJobs.length > MAX_JOBS_VISIBLE_PER_CELL && (
                            <p className="px-0.5 text-[10px] font-medium text-text-tertiary">
                              +{dayJobs.length - MAX_JOBS_VISIBLE_PER_CELL} more
                            </p>
                          )}
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div
          className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
          style={{ minHeight: "min(70vh, calc(100vh - 12rem))" }}
        >
          {calendarView === "week" ? (
            <WeekView
              jobs={pipelineForTimeGrids}
              onSelectJob={onSelectJob}
              accountLogoByClientId={accountLogoByClientId}
              weekAnchor={dayCursor}
            />
          ) : (
            <PartnerDayTimelineView
              jobs={pipelineForTimeGrids}
              onSelectJob={onSelectJob}
              accountLogoByClientId={accountLogoByClientId}
              dayAnchor={dayCursor}
              partnerRows={dayTimelinePartnerRows}
            />
          )}
        </div>
      )}
    </Card>
  );
}
