"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { Avatar } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Tabs } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ScheduleLiveMap, type ScheduleLiveMapPoint } from "@/components/dashboard/schedule-live-map";
import { JobOverdueBadge } from "@/components/shared/job-overdue-badge";
import { motion, AnimatePresence } from "framer-motion";
import { staggerContainer, staggerItem, fadeInUp } from "@/lib/motion";
import {
  Plus, ChevronLeft, ChevronRight, Calendar as CalIcon,
  Briefcase, AlertTriangle, MapPin, DollarSign, User, RefreshCw, Search,
} from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { getLatestLocation, getTeamMembers } from "@/services/partner-detail";
import type { Job } from "@/types/database";
import {
  formatJobScheduleLine,
  formatLocalYmd,
  formatScheduleCalendarBarTooltip,
  jobFinishYmd,
  jobIntersectsLocalMonth,
  jobScheduleYmd,
  localYmdBoundsToUtcIso,
} from "@/lib/schedule-calendar";
import {
  formatScheduleCalendarBarCompact,
  scheduleJobStatusColorClasses,
  SCHEDULE_TYPE_ABBR,
  resolveScheduleJobTypeKey,
  scheduleJobAbbrevFromTitle,
} from "@/lib/schedule-job-type-style";
import { isJobInProgressStatus } from "@/lib/job-phases";
import { jobBillableRevenue, jobDirectCost, jobProfit } from "@/lib/job-financials";
import {
  isJobExcludedFromScheduleView,
  scheduleJobBarDoneVisually,
  scheduleJobNeedsAssignmentHighlight,
  sumScheduleMonthRevenue,
} from "@/lib/schedule-visible-jobs";
import { batchResolveLinkedAccountLabels } from "@/lib/client-linked-account-label";
import { JOB_STATUS_BADGE_VARIANT } from "@/lib/job-status-ui";
import type { BadgeVariant } from "@/components/ui/badge";

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const LIVE_MAP_INACTIVE_MINUTES = 15;
type LiveMapStatusFilter = "all" | "active" | "inactive";

const statusConfig: Record<string, { label: string; variant: BadgeVariant }> = {
  unassigned: { label: "Unassigned", variant: JOB_STATUS_BADGE_VARIANT.unassigned },
  auto_assigning: { label: "Assigning", variant: JOB_STATUS_BADGE_VARIANT.auto_assigning },
  scheduled: { label: "Scheduled", variant: JOB_STATUS_BADGE_VARIANT.scheduled },
  late: { label: "Late", variant: JOB_STATUS_BADGE_VARIANT.late },
  in_progress_phase1: { label: "In progress", variant: JOB_STATUS_BADGE_VARIANT.in_progress_phase1 },
  in_progress_phase2: { label: "In progress", variant: JOB_STATUS_BADGE_VARIANT.in_progress_phase2 },
  in_progress_phase3: { label: "In progress", variant: JOB_STATUS_BADGE_VARIANT.in_progress_phase3 },
  on_hold: { label: "On hold", variant: JOB_STATUS_BADGE_VARIANT.on_hold },
  final_check: { label: "Final check", variant: JOB_STATUS_BADGE_VARIANT.final_check },
  awaiting_payment: { label: "Awaiting payment", variant: JOB_STATUS_BADGE_VARIANT.awaiting_payment },
  need_attention: { label: "Need attention", variant: JOB_STATUS_BADGE_VARIANT.need_attention },
  completed: { label: "Completed", variant: JOB_STATUS_BADGE_VARIANT.completed },
  cancelled: { label: "Cancelled", variant: JOB_STATUS_BADGE_VARIANT.cancelled },
  deleted: { label: "Deleted", variant: JOB_STATUS_BADGE_VARIANT.deleted },
};

type ScheduleBarSegment = "only" | "first" | "middle" | "last";

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
  /** Adjacent calendar cell (works across Sat→Sun and week rows), not just same week row. */
  if (dayGridIndex > 0) left = hasOn(calendarDays[dayGridIndex - 1]);
  if (dayGridIndex < calendarDays.length - 1) right = hasOn(calendarDays[dayGridIndex + 1]);
  if (!left && !right) return "only";
  if (!left && right) return "first";
  if (left && right) return "middle";
  return "last";
}

function scheduleBarSegmentClass(segment: ScheduleBarSegment, colorClasses: string): string {
  const base = cn(
    "flex w-full min-w-0 items-center px-1.5 py-0.5 text-[9px] font-semibold leading-tight border cursor-pointer hover:opacity-90 transition-opacity",
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

export default function SchedulePage() {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedJobAccountName, setSelectedJobAccountName] = useState<string | null>(null);
  const [legendBarChipsOpen, setLegendBarChipsOpen] = useState(false);
  const [view, setView] = useState<"calendar" | "live_map">("calendar");
  const [liveMapPoints, setLiveMapPoints] = useState<ScheduleLiveMapPoint[]>([]);
  const [loadingLiveMap, setLoadingLiveMap] = useState(false);
  const [liveMapUpdatedAt, setLiveMapUpdatedAt] = useState<string | null>(null);
  const [liveMapSearch, setLiveMapSearch] = useState("");
  const [liveMapStatusFilter, setLiveMapStatusFilter] = useState<LiveMapStatusFilter>("all");

  const loadJobs = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabase();
    try {
      const padStart = formatLocalYmd(new Date(year, month, 1 - 62));
      const padEnd = formatLocalYmd(new Date(year, month + 1, 62));
      const { startIso: padStartUtc, endIso: padEndUtc } = localYmdBoundsToUtcIso(padStart, padEnd);

      const [byScheduledDate, byFinishDate, byStartAt, byEndAt] = await Promise.all([
        supabase
          .from("jobs")
          .select("*")
          .is("deleted_at", null)
          .gte("scheduled_date", padStart)
          .lte("scheduled_date", padEnd)
          .order("scheduled_date", { ascending: true }),
        supabase
          .from("jobs")
          .select("*")
          .is("deleted_at", null)
          .not("scheduled_finish_date", "is", null)
          .gte("scheduled_finish_date", padStart)
          .lte("scheduled_finish_date", padEnd)
          .order("scheduled_finish_date", { ascending: true }),
        supabase
          .from("jobs")
          .select("*")
          .is("deleted_at", null)
          .not("scheduled_start_at", "is", null)
          .gte("scheduled_start_at", padStartUtc)
          .lte("scheduled_start_at", padEndUtc)
          .order("scheduled_start_at", { ascending: true }),
        supabase
          .from("jobs")
          .select("*")
          .is("deleted_at", null)
          .not("scheduled_end_at", "is", null)
          .gte("scheduled_end_at", padStartUtc)
          .lte("scheduled_end_at", padEndUtc)
          .order("scheduled_end_at", { ascending: true }),
      ]);

      const merged = new Map<string, Job>();
      for (const row of [
        ...(byScheduledDate.data ?? []),
        ...(byFinishDate.data ?? []),
        ...(byStartAt.data ?? []),
        ...(byEndAt.data ?? []),
      ]) {
        merged.set(row.id, row as Job);
      }
      const list = Array.from(merged.values())
        .filter((j) => !isJobExcludedFromScheduleView(j))
        .filter((j) => jobIntersectsLocalMonth(j, year, month));
      list.sort((a, b) => {
        const ka = a.scheduled_start_at ?? (a.scheduled_date ? `${a.scheduled_date}T00:00:00` : "");
        const kb = b.scheduled_start_at ?? (b.scheduled_date ? `${b.scheduled_date}T00:00:00` : "");
        return ka.localeCompare(kb);
      });
      setJobs(list);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  const activeCount = useMemo(() => jobs.length, [jobs]);
  const unassignedCount = useMemo(
    () => jobs.filter((j) => j.status === "unassigned" || j.status === "auto_assigning").length,
    [jobs],
  );

  const loadLiveMap = useCallback(async () => {
    setLoadingLiveMap(true);
    const supabase = getSupabase();
    try {
      // Primary source: app users from Team (App) logic (jobs.partner_id + linked auth_user_id).
      const members = await getTeamMembers();
      const byId = new Map<string, string>();
      for (const m of members) {
        if (m?.id) byId.set(m.id, m.full_name?.trim() || "Partner");
      }

      // Fallback source: explicitly linked partners table.
      const { data: linkedPartners } = await supabase
        .from("partners")
        .select("company_name, auth_user_id")
        .not("auth_user_id", "is", null);
      for (const p of (linkedPartners ?? []) as Array<{ company_name: string | null; auth_user_id: string | null }>) {
        if (p.auth_user_id && !byId.has(p.auth_user_id)) {
          byId.set(p.auth_user_id, p.company_name?.trim() || "Partner");
        }
      }

      const list = Array.from(byId.entries()).map(([userId, name]) => ({ userId, name }));
      const nowMs = Date.now();

      const rows = await Promise.all(
        list.map(async (p) => {
            const loc = await getLatestLocation(p.userId);
            if (!loc) return null;
            const minutesSincePing = Math.floor((nowMs - new Date(loc.created_at).getTime()) / 60000);
            const inactive = !loc.is_active || minutesSincePing > LIVE_MAP_INACTIVE_MINUTES;
            return {
              id: p.userId,
              name: p.name,
              latitude: Number(loc.latitude),
              longitude: Number(loc.longitude),
              lastUpdateIso: loc.created_at,
              inactive,
            } satisfies ScheduleLiveMapPoint;
          })
      );

      setLiveMapPoints(rows.filter((r): r is ScheduleLiveMapPoint => !!r));
      setLiveMapUpdatedAt(new Date().toISOString());
    } catch {
      // non-critical map panel
    } finally {
      setLoadingLiveMap(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  /** Refresh when returning from Jobs (or another tab) so deletes/cancels drop off without a full reload. */
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void loadJobs();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loadJobs]);

  useEffect(() => {
    loadLiveMap();
    const timer = setInterval(() => {
      void loadLiveMap();
    }, 60_000);
    return () => clearInterval(timer);
  }, [loadLiveMap]);

  useEffect(() => {
    const clientId = selectedJob?.client_id?.trim();
    if (!clientId) {
      setSelectedJobAccountName(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const supabase = getSupabase();
      const labels = await batchResolveLinkedAccountLabels(supabase, [clientId]);
      if (!cancelled) setSelectedJobAccountName(labels.get(clientId) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedJob?.client_id, selectedJob?.id]);

  const goToday = () => {
    setYear(now.getFullYear());
    setMonth(now.getMonth());
  };

  const goPrev = () => {
    if (month === 0) { setMonth(11); setYear(year - 1); }
    else setMonth(month - 1);
  };

  const goNext = () => {
    if (month === 11) { setMonth(0); setYear(year + 1); }
    else setMonth(month + 1);
  };

  const isToday = year === now.getFullYear() && month === now.getMonth();
  const todayDate = now.getDate();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7;

  const calendarDays: (number | null)[] = useMemo(() => {
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDayOfWeek; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [firstDayOfWeek, daysInMonth]);

  const jobsByDay = useMemo(() => {
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    const jobDaysInMonth = new Map<string, Set<number>>();
    for (const job of jobs) {
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
    for (const job of jobs) {
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
  }, [jobs, year, month, calendarDays]);

  const selectedScheduleLine = selectedJob ? formatJobScheduleLine(selectedJob) : null;

  const monthRevenue = useMemo(() => sumScheduleMonthRevenue(jobs), [jobs]);
  const inProgressCount = useMemo(
    () => jobs.filter((j) => isJobInProgressStatus(j.status)).length,
    [jobs],
  );
  const hasUnassigned = unassignedCount > 0;
  const liveActiveCount = useMemo(() => liveMapPoints.filter((p) => !p.inactive).length, [liveMapPoints]);
  const liveInactiveCount = useMemo(() => liveMapPoints.filter((p) => p.inactive).length, [liveMapPoints]);

  const filteredLiveMapPoints = useMemo(() => {
    const q = liveMapSearch.trim().toLowerCase();
    return liveMapPoints.filter((p) => {
      if (liveMapStatusFilter === "active" && p.inactive) return false;
      if (liveMapStatusFilter === "inactive" && !p.inactive) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [liveMapPoints, liveMapSearch, liveMapStatusFilter]);

  const liveMapFiltersActive =
    liveMapSearch.trim().length > 0 || liveMapStatusFilter !== "all";

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Schedule & Dispatch" subtitle="Manage job scheduling, partner assignments and dispatch.">
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />}>New Booking</Button>
        </PageHeader>

        <div className="rounded-xl border border-border-light bg-card/60 px-4 py-2">
          <button
            type="button"
            onClick={() => setLegendBarChipsOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-2 rounded-lg py-1.5 text-left -mx-1 px-1 hover:bg-surface-hover/60 transition-colors"
            aria-expanded={legendBarChipsOpen}
          >
            <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Legend — bar chips</span>
            <ChevronRight
              className={cn(
                "h-4 w-4 shrink-0 text-text-tertiary transition-transform duration-200",
                legendBarChipsOpen && "rotate-90",
              )}
              aria-hidden
            />
          </button>
          <AnimatePresence initial={false}>
            {legendBarChipsOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5 text-[11px] text-text-secondary pt-2 pb-1">
                  {Object.entries(SCHEDULE_TYPE_ABBR).map(([label, abbr]) => (
                    <div key={label} className="flex items-baseline gap-2 min-w-0">
                      <span className="font-mono font-semibold text-text-primary shrink-0 tabular-nums">{abbr}</span>
                      <span className="truncate">{label}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Jobs this month" value={activeCount} format="number" icon={Briefcase} accent="blue" />
          <KpiCard title="In progress" value={inProgressCount} format="number" icon={RefreshCw} accent="emerald" />
          <KpiCard
            title={view === "calendar" ? "Total revenue this month" : "Total on map"}
            value={view === "calendar" ? monthRevenue : liveMapPoints.length}
            format={view === "calendar" ? "currency" : "number"}
            icon={view === "calendar" ? DollarSign : MapPin}
            accent="purple"
            description={
              view === "calendar"
                ? "Billable total for jobs in this month (excl. cancelled / deleted / lost)"
                : view === "live_map" && liveMapPoints.length > 0
                  ? liveMapFiltersActive
                    ? `Visible ${filteredLiveMapPoints.length} / ${liveMapPoints.length}`
                    : `${liveMapPoints.length} with location`
                  : undefined
            }
          />
          <KpiCard
            title="Unassigned"
            value={unassignedCount}
            format="number"
            description={hasUnassigned ? "Needs immediate attention" : "All assigned"}
            icon={AlertTriangle}
            accent={hasUnassigned ? "amber" : "emerald"}
            className={
              hasUnassigned
                ? "border-red-300 bg-red-50/70 dark:bg-red-950/20"
                : "border-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/20"
            }
          />
        </StaggerContainer>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs
            tabs={[
              { id: "calendar", label: "Calendar" },
              { id: "live_map", label: "Live map", count: liveMapPoints.length },
            ]}
            activeTab={view}
            onChange={(id) => setView(id as "calendar" | "live_map")}
            variant="pills"
          />
          {view === "live_map" && (
            <Button variant="ghost" size="sm" onClick={() => void loadLiveMap()} icon={<RefreshCw className={cn("h-3.5 w-3.5", loadingLiveMap && "animate-spin")} />}>
              Refresh
            </Button>
          )}
        </div>

        {view === "calendar" ? (
          <motion.div variants={fadeInUp} initial="hidden" animate="visible">
            <Card padding="none">
            {/* Calendar Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
              <div className="flex items-center gap-3">
                <button
                  onClick={goPrev}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-tertiary transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <h3 className="text-base font-semibold text-text-primary min-w-[160px] text-center">
                  {MONTHS[month]} {year}
                </h3>
                <button
                  onClick={goNext}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-tertiary transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                {!isToday && (
                  <Button variant="ghost" size="sm" onClick={goToday}>Today</Button>
                )}
              </div>
              <div className="flex items-center gap-3">
                {loading && (
                  <span className="text-xs text-text-tertiary animate-pulse">Loading...</span>
                )}
                <div className="flex items-center gap-2 text-xs text-text-tertiary">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-primary" />
                    {jobs.length} jobs this month
                  </span>
                </div>
              </div>
            </div>

            {/* Day Headers */}
            <div className="grid grid-cols-7">
              {DAYS_OF_WEEK.map((day) => (
                <div key={day} className="px-3 py-2 text-center text-[11px] font-semibold text-text-tertiary uppercase tracking-wider border-b border-border-light">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7">
              {calendarDays.map((day, index) => {
                const dayJobs = day ? (jobsByDay[day] || []) : [];
                const isTodayCell = isToday && day === todayDate;
                return (
                  <div
                    key={index}
                    className={`min-h-[110px] p-1.5 border-b border-r border-border-light transition-colors ${
                      isTodayCell ? "bg-primary/[0.03]" : day ? "hover:bg-surface-hover/40" : "bg-surface-hover/20"
                    }`}
                  >
                    {day && (
                      <>
                        <div className="flex items-center justify-between px-1 mb-1">
                          <span className={`text-xs font-medium ${
                            isTodayCell
                              ? "h-6 w-6 rounded-full bg-primary text-white flex items-center justify-center"
                              : "text-text-secondary"
                          }`}>
                            {day}
                          </span>
                          {dayJobs.length > 0 && (
                            <span className="text-[10px] text-text-tertiary">{dayJobs.length}</span>
                          )}
                        </div>
                        <div className="space-y-0.5 min-w-0">
                          {dayJobs.slice(0, 3).map(({ job, segment }, idx) => (
                            <motion.div
                              key={`${job.id}-${day}-${segment}-${idx}`}
                              whileHover={{ scale: 1.01 }}
                              whileTap={{ scale: 0.99 }}
                              onClick={() => setSelectedJob(job)}
                              title={formatScheduleCalendarBarTooltip(job)}
                              className={cn(
                                scheduleBarSegmentClass(segment, scheduleJobStatusColorClasses(job.status)),
                                scheduleJobBarDoneVisually(job) && "opacity-[0.68] line-through decoration-text-current/90",
                                scheduleJobNeedsAssignmentHighlight(job) &&
                                  "ring-2 ring-amber-500/85 ring-offset-1 ring-offset-card shadow-sm",
                              )}
                            >
                              <span className="min-w-0 flex-1 truncate">{formatScheduleCalendarBarCompact(job)}</span>
                            </motion.div>
                          ))}
                          {dayJobs.length > 3 && (
                            <p className="text-[10px] text-text-tertiary px-1">+{dayJobs.length - 3} more</p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            </Card>
          </motion.div>
        ) : (
          <motion.div variants={fadeInUp} initial="hidden" animate="visible" className="space-y-3">
            <Card className="p-4">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs">
                  <Badge variant="success" size="sm" dot>Active now: {liveActiveCount}</Badge>
                  <Badge variant="warning" size="sm" dot>Inactive (last location): {liveInactiveCount}</Badge>
                  {liveMapUpdatedAt && (
                    <span className="text-text-tertiary">
                      Updated: {new Date(liveMapUpdatedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <div className="flex w-full min-w-0 flex-col gap-2 sm:max-w-sm lg:w-80 lg:shrink-0">
                  <Input
                    type="search"
                    placeholder="Search partner…"
                    value={liveMapSearch}
                    onChange={(e) => setLiveMapSearch(e.target.value)}
                    icon={<Search className="h-4 w-4" />}
                    aria-label="Filter partners by name"
                  />
                  <div className="flex gap-1 rounded-xl bg-surface-tertiary p-1">
                    {(
                      [
                        { id: "all" as const, label: "All" },
                        { id: "active" as const, label: "Active" },
                        { id: "inactive" as const, label: "Inactive" },
                      ] as const
                    ).map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setLiveMapStatusFilter(id)}
                        className={cn(
                          "min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                          liveMapStatusFilter === id
                            ? "bg-card text-text-primary shadow-sm"
                            : "text-text-secondary hover:text-text-primary",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {filteredLiveMapPoints.length === 0 && liveMapPoints.length > 0 && (
                <p className="mb-3 text-sm text-text-secondary">
                  No partners match these filters. Clear search or set status to &quot;All&quot;.
                </p>
              )}
              <ScheduleLiveMap points={filteredLiveMapPoints} />
            </Card>
          </motion.div>
        )}
      </div>

      {/* Job Detail Drawer */}
      <Drawer
        open={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        title={selectedJob?.reference}
        subtitle={selectedJob?.title}
        width="w-[440px]"
      >
        {selectedJob && (
          <div className="p-6 space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-surface-hover">
                <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Status</label>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge variant={statusConfig[selectedJob.status]?.variant ?? "default"} dot size="md">
                    {statusConfig[selectedJob.status]?.label ?? selectedJob.status}
                  </Badge>
                  <JobOverdueBadge job={selectedJob} size="md" />
                </div>
              </div>
              <div className="p-3 rounded-xl bg-surface-hover">
                <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Progress</label>
                <div className="mt-1.5">
                  <span className="text-lg font-bold text-text-primary">{selectedJob.progress}%</span>
                  <Progress value={selectedJob.progress} size="sm" color={selectedJob.progress === 100 ? "emerald" : "primary"} className="mt-1" />
                </div>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Client</label>
              <p className="text-sm font-semibold text-text-primary mt-1">{selectedJob.client_name}</p>
              <p className="text-xs text-text-secondary mt-1">
                {selectedJobAccountName ? (
                  <span>{selectedJobAccountName}</span>
                ) : selectedJob.client_id ? (
                  <span className="text-text-tertiary italic">No linked account</span>
                ) : (
                  <span className="text-text-tertiary italic">—</span>
                )}
              </p>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Type of work</label>
              <p className="text-sm text-text-primary mt-1">
                {resolveScheduleJobTypeKey(selectedJob.title)}
                <span className="text-text-tertiary text-xs ml-2 font-mono">({scheduleJobAbbrevFromTitle(selectedJob.title)})</span>
              </p>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Scope of work</label>
              {selectedJob.scope?.trim() ? (
                <p className="text-sm text-text-primary mt-1 whitespace-pre-wrap break-words max-h-32 overflow-y-auto rounded-lg border border-border-light bg-surface-hover/50 px-2.5 py-2">
                  {selectedJob.scope.trim()}
                </p>
              ) : (
                <p className="text-sm text-text-tertiary italic mt-1">No scope of work recorded</p>
              )}
            </div>

            <div>
              <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Property (full address)</label>
              <div className="flex items-start gap-2 mt-1">
                <MapPin className="h-4 w-4 text-text-tertiary mt-0.5 shrink-0" />
                <p className="text-sm text-text-primary break-words">{selectedJob.property_address}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-surface-hover">
                <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Partner</label>
                {selectedJob.partner_name ? (
                  <div className="flex items-center gap-2 mt-2">
                    <Avatar name={selectedJob.partner_name} size="sm" />
                    <p className="text-sm font-medium text-text-primary">{selectedJob.partner_name}</p>
                  </div>
                ) : (
                  <p className="text-sm text-amber-600 font-medium mt-2">Unassigned</p>
                )}
              </div>
              <div className="p-3 rounded-xl bg-surface-hover">
                <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Owner</label>
                {selectedJob.owner_name ? (
                  <div className="flex items-center gap-2 mt-2">
                    <Avatar name={selectedJob.owner_name} size="sm" />
                    <p className="text-sm font-medium text-text-primary">{selectedJob.owner_name}</p>
                  </div>
                ) : (
                  <p className="text-sm text-text-tertiary italic mt-2">No owner</p>
                )}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-gradient-to-br from-surface-hover to-surface-tertiary/50 border border-border-light space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="h-4 w-4 text-text-tertiary" />
                <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Financial snapshot</label>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-text-secondary">Price (customer)</span>
                <span className="text-base font-bold text-text-primary tabular-nums">{formatCurrency(jobBillableRevenue(selectedJob))}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-text-secondary">Cost (partner + materials)</span>
                <span className="text-sm font-semibold text-text-primary tabular-nums">{formatCurrency(jobDirectCost(selectedJob))}</span>
              </div>
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-border-light/80">
                <span className="text-sm text-text-secondary">Gross profit</span>
                <span className="text-sm font-semibold tabular-nums text-text-primary">{formatCurrency(jobProfit(selectedJob))}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-text-secondary">Margin</span>
                <span className={`text-sm font-semibold ${selectedJob.margin_percent >= 20 ? "text-emerald-600" : "text-amber-600"}`}>
                  {selectedJob.margin_percent}%
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-tertiary">
              {selectedScheduleLine && (
                <span>Scheduled: {selectedScheduleLine}</span>
              )}
              <span>
                Phase {Math.min(selectedJob.total_phases, 2) === 2 ? (selectedJob.report_2_uploaded ? 2 : 1) : 1}/{Math.min(selectedJob.total_phases, 2)}
              </span>
            </div>

            <div className="pt-4 border-t border-border-light">
              <Button
                className="w-full"
                onClick={() => {
                  const id = selectedJob.id;
                  setSelectedJob(null);
                  router.push(`/jobs/${id}`);
                }}
              >
                Open in Jobs Management
              </Button>
            </div>
          </div>
        )}
      </Drawer>
    </PageTransition>
  );
}
