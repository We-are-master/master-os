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
import { formatCurrency } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import type { Job } from "@/types/database";
import { formatJobScheduleLine, formatLocalYmd, jobFinishYmd, jobScheduleYmd } from "@/lib/schedule-calendar";
import { isJobInProgressStatus } from "@/lib/job-phases";

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const tradeColors: Record<string, string> = {
  "HVAC": "bg-blue-100 text-blue-700 border-blue-200",
  "Electrical": "bg-purple-100 text-purple-700 border-purple-200",
  "Plumbing": "bg-teal-100 text-teal-700 border-teal-200",
  "Painting": "bg-emerald-100 text-emerald-700 border-emerald-200",
  "Carpentry": "bg-amber-100 text-amber-700 border-amber-200",
  "General": "bg-surface-tertiary text-text-primary border-border",
};

function getJobColor(title: string): string {
  const key = Object.keys(tradeColors).find((k) => title.toLowerCase().includes(k.toLowerCase()));
  return key ? tradeColors[key] : "bg-indigo-100 text-indigo-700 border-indigo-200";
}

const statusConfig: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" }> = {
  pending_schedule: { label: "Pending Schedule", variant: "warning" },
  in_progress: { label: "In Progress", variant: "primary" },
  on_hold: { label: "On Hold", variant: "danger" },
  completed: { label: "Completed", variant: "success" },
  cancelled: { label: "Cancelled", variant: "default" },
};

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
      const startDate = formatLocalYmd(new Date(year, month, 1));
      const endDate = formatLocalYmd(new Date(year, month + 1, 0));
      const monthStartInstant = new Date(year, month, 1, 0, 0, 0, 0).toISOString();
      const nextMonthStartInstant = new Date(year, month + 1, 1, 0, 0, 0, 0).toISOString();

      const [byScheduledDate, byStartAt, byEndAt] = await Promise.all([
        supabase
          .from("jobs")
          .select("*")
          .gte("scheduled_date", startDate)
          .lte("scheduled_date", endDate)
          .order("scheduled_date", { ascending: true }),
        supabase
          .from("jobs")
          .select("*")
          .not("scheduled_start_at", "is", null)
          .gte("scheduled_start_at", monthStartInstant)
          .lt("scheduled_start_at", nextMonthStartInstant)
          .order("scheduled_start_at", { ascending: true }),
        supabase
          .from("jobs")
          .select("*")
          .not("scheduled_end_at", "is", null)
          .gte("scheduled_end_at", monthStartInstant)
          .lt("scheduled_end_at", nextMonthStartInstant)
          .order("scheduled_end_at", { ascending: true }),
      ]);

      const merged = new Map<string, Job>();
      for (const row of [...(byScheduledDate.data ?? []), ...(byStartAt.data ?? []), ...(byEndAt.data ?? [])]) {
        merged.set(row.id, row as Job);
      }
      const list = Array.from(merged.values()).filter((j) => {
        const ymd = jobScheduleYmd(j);
        return ymd && ymd.y === year && ymd.m === month + 1;
      });
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
      const { data } = await supabase.from("jobs").select("*");
      const allJobs = (data ?? []) as Job[];
      const withDate = allJobs.filter((j) => j.scheduled_date);
      const withoutDate = allJobs.filter((j) => !j.scheduled_date && j.status !== "completed");
      setStats({
        total: allJobs.length,
        scheduled: withDate.length,
        unassigned: withoutDate.length,
        active: allJobs.filter((j) => isJobInProgressStatus(j.status)).length,
      });
    } catch { /* cosmetic */ }
  }, []);

  const [stats, setStats] = useState({ total: 0, scheduled: 0, unassigned: 0, active: 0 });

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
    const map: Record<number, Array<{ job: Job; kind: "start" | "end" | "span" }>> = {};
    for (const job of jobs) {
      const start = jobScheduleYmd(job);
      if (!start) continue;
      const finish = jobFinishYmd(job);
      const startsThisMonth = start.y === year && start.m === month + 1;
      const finishesThisMonth = !!finish && finish.y === year && finish.m === month + 1;

      if (startsThisMonth) {
        if (!map[start.d]) map[start.d] = [];
        map[start.d].push({ job, kind: "start" });
      }
      if (finishesThisMonth) {
        if (!map[finish!.d]) map[finish!.d] = [];
        map[finish!.d].push({ job, kind: "end" });
      }

      if (!finish) continue;
      const cursor = new Date(start.y, start.m - 1, start.d);
      const endDate = new Date(finish.y, finish.m - 1, finish.d);
      cursor.setDate(cursor.getDate() + 1);
      while (cursor < endDate) {
        if (cursor.getFullYear() === year && cursor.getMonth() === month) {
          const d = cursor.getDate();
          if (!map[d]) map[d] = [];
          map[d].push({ job, kind: "span" });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return map;
  }, [jobs, year, month]);

  const selectedScheduleLine = selectedJob ? formatJobScheduleLine(selectedJob) : null;

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Schedule & Dispatch" subtitle="Manage job scheduling, partner assignments and dispatch.">
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />}>New Booking</Button>
        </PageHeader>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Active Jobs" value={stats.active} format="number" icon={Briefcase} accent="blue" />
          <KpiCard title="Scheduled This Month" value={jobs.length} format="number" icon={CalIcon} accent="emerald" />
          <KpiCard title="Total Jobs" value={stats.total} format="number" icon={Briefcase} accent="primary" />
          <KpiCard title="Unscheduled" value={stats.unassigned} format="number" description="Need date assignment" icon={AlertTriangle} accent="amber" />
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
                        <div className="space-y-0.5">
                          {dayJobs.slice(0, 3).map(({ job, kind }, idx) => (
                            <motion.div
                              key={`${job.id}-${kind}-${idx}`}
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => setSelectedJob(job)}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium border truncate cursor-pointer hover:opacity-80 transition-opacity ${
                                kind === "start"
                                  ? `${getJobColor(job.title)}`
                                  : kind === "end"
                                    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                    : "bg-amber-100 text-amber-700 border-amber-200"
                              }`}
                            >
                              {kind === "start" ? "Start" : kind === "end" ? "Finish" : "In progress"} · {job.title}
                              {!job.partner_name && <span className="italic opacity-70"> (unasgn.)</span>}
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
