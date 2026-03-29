"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { Avatar } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { motion, AnimatePresence } from "framer-motion";
import { staggerContainer, staggerItem, fadeInUp } from "@/lib/motion";
import {
  Plus, ChevronLeft, ChevronRight, Calendar as CalIcon,
  Briefcase, AlertTriangle, MapPin, DollarSign, User,
} from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
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
} from "@/lib/schedule-job-type-style";
import { isJobInProgressStatus } from "@/lib/job-phases";
import { jobBillableRevenue } from "@/lib/job-financials";

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const statusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" }> = {
  unassigned: { label: "Unassigned", variant: "warning" },
  scheduled: { label: "Scheduled", variant: "default" },
  late: { label: "Late", variant: "danger" },
  in_progress_phase1: { label: "In progress", variant: "primary" },
  in_progress_phase2: { label: "In progress", variant: "primary" },
  in_progress_phase3: { label: "In progress", variant: "primary" },
  final_check: { label: "Final check", variant: "warning" },
  awaiting_payment: { label: "Awaiting payment", variant: "danger" },
  need_attention: { label: "Need attention", variant: "warning" },
  completed: { label: "Completed", variant: "success" },
  cancelled: { label: "Cancelled", variant: "default" },
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
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

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
      const list = Array.from(merged.values()).filter((j) => jobIntersectsLocalMonth(j, year, month));
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

  const loadAllJobs = useCallback(async () => {
    const supabase = getSupabase();
    try {
      const { data } = await supabase.from("jobs").select("*").is("deleted_at", null);
      const allJobs = (data ?? []) as Job[];
      const withoutDate = allJobs.filter(
        (j) =>
          !j.scheduled_date &&
          !j.scheduled_start_at &&
          j.status !== "completed" &&
          j.status !== "cancelled",
      );
      setStats({
        unscheduled: withoutDate.length,
        active: allJobs.filter((j) => isJobInProgressStatus(j.status)).length,
      });
    } catch { /* cosmetic */ }
  }, []);

  const [stats, setStats] = useState({ unscheduled: 0, active: 0 });

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    loadAllJobs();
  }, [loadAllJobs]);

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

  const monthRevenue = useMemo(
    () =>
      jobs.filter((j) => j.status !== "cancelled").reduce((sum, j) => sum + jobBillableRevenue(j), 0),
    [jobs],
  );

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Schedule & Dispatch" subtitle="Manage job scheduling, partner assignments and dispatch.">
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />}>New Booking</Button>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Active" value={stats.active} format="number" icon={Briefcase} accent="blue" />
          <KpiCard title="Schedule this month" value={jobs.length} format="number" icon={CalIcon} accent="emerald" />
          <KpiCard title="Unscheduled" value={stats.unscheduled} format="number" description="Need date assignment" icon={AlertTriangle} accent="amber" />
          <KpiCard title="Total revenue this month" value={monthRevenue} format="currency" icon={DollarSign} accent="purple" />
        </StaggerContainer>

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
                              className={scheduleBarSegmentClass(segment, scheduleJobStatusColorClasses(job.status))}
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
                <div className="mt-1.5">
                  <Badge variant={statusConfig[selectedJob.status]?.variant ?? "default"} dot size="md">
                    {statusConfig[selectedJob.status]?.label ?? selectedJob.status}
                  </Badge>
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
            </div>

            <div>
              <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Property</label>
              <div className="flex items-start gap-2 mt-1">
                <MapPin className="h-4 w-4 text-text-tertiary mt-0.5 shrink-0" />
                <p className="text-sm text-text-primary">{selectedJob.property_address}</p>
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

            <div className="p-4 rounded-xl bg-gradient-to-br from-surface-hover to-surface-tertiary/50 border border-border-light">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-4 w-4 text-text-tertiary" />
                <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Financial</label>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Value</span>
                <span className="text-lg font-bold text-text-primary">{formatCurrency(selectedJob.client_price)}</span>
              </div>
              <div className="flex items-center justify-between mt-1">
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
                  setSelectedJob(null);
                  window.location.href = "/jobs";
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
