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
import {
  ScheduleLiveMap,
  LIVE_MAP_TOOLBAR_BTN_CLASS,
  type LiveMapRegionPreset,
  type ScheduleLiveMapJobPoint,
  type ScheduleLiveMapPoint,
} from "@/components/dashboard/schedule-live-map";
import {
  liveMapJobStatusLegend,
  liveMapTradeFilterOptions,
  type LiveMapJobStatusCategory,
} from "@/components/dashboard/live-map-marker-icons";
import { liveMapPointMatchesTradeFilter } from "@/lib/live-map-trade-filter";
import { normalizeTypeOfWork } from "@/lib/type-of-work";
import { JobOverdueBadge } from "@/components/shared/job-overdue-badge";
import { motion, AnimatePresence } from "framer-motion";
import { staggerContainer, staggerItem, fadeInUp } from "@/lib/motion";
import {
  Plus, ChevronLeft, ChevronRight, Calendar as CalIcon,
  Briefcase, AlertTriangle, MapPin, DollarSign, User, Users, RefreshCw, Search, Download, ChevronDown,
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
import { batchResolveLinkedAccountLabels, batchResolveClientAccountLogoUrls } from "@/lib/client-linked-account-label";
import { JOB_STATUS_BADGE_VARIANT } from "@/lib/job-status-ui";
import type { BadgeVariant } from "@/components/ui/badge";
import { ExportCsvModal } from "@/components/shared/export-csv-modal";
import { buildCsvFromRows, downloadCsvFile } from "@/lib/csv-export";

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const LIVE_MAP_INACTIVE_MINUTES = 15;

const LIVE_MAP_REGION_OPTIONS: { value: LiveMapRegionPreset; label: string }[] = [
  { value: "fit_all", label: "All" },
  { value: "uk", label: "United Kingdom" },
  { value: "london", label: "London" },
  { value: "europe", label: "Europe" },
];

const LIVE_MAP_NATIVE_SELECT_CLASS =
  "h-8 min-w-[120px] flex-1 appearance-none rounded-md border-[0.5px] border-[#D8D8DD] bg-white py-1 pl-2 pr-8 text-[11px] font-medium text-[#020040] outline-none focus:ring-2 focus:ring-[#020040]/15 sm:min-w-[140px] sm:flex-none";

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

/**
 * Buckets a job.status value into one of the four live-map color categories
 * so the map pins mirror the Fixfy semantic palette:
 *   unassigned / auto_assigning → red
 *   scheduled                   → green
 *   in_progress_phase1/2/3      → blue
 *   late / need_attention / awaiting_payment / final_check / on_hold → orange
 *
 * Anything else (e.g. completed / cancelled) is filtered out upstream before
 * reaching this helper, but falls back to "attention" defensively.
 */
function liveMapCategoryForStatus(status: string): LiveMapJobStatusCategory {
  if (status === "unassigned" || status === "auto_assigning") return "unassigned";
  if (status === "scheduled") return "scheduled";
  if (status.startsWith("in_progress")) return "in_progress";
  return "attention";
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
  const [accountLogoByClientId, setAccountLogoByClientId] = useState<Map<string, string | null>>(() => new Map());
  const [legendBarChipsOpen, setLegendBarChipsOpen] = useState(false);
  const [view, setView] = useState<"calendar" | "live_map">("calendar");
  const [liveMapPoints, setLiveMapPoints] = useState<ScheduleLiveMapPoint[]>([]);
  const [loadingLiveMap, setLoadingLiveMap] = useState(false);
  const [liveMapUpdatedAt, setLiveMapUpdatedAt] = useState<string | null>(null);
  const [liveMapSearch, setLiveMapSearch] = useState("");
  const [liveMapStatusFilter, setLiveMapStatusFilter] = useState<LiveMapStatusFilter>("all");
  const [liveMapRegionPreset, setLiveMapRegionPreset] = useState<LiveMapRegionPreset>("fit_all");
  const [liveMapTradeFilter, setLiveMapTradeFilter] = useState<"all" | string>("all");
  // Live-map dispatch overlay: date layer + per-job selection for manual ops.
  // Defaults to today so the map opens with "jobs scheduled today" pinned.
  const [liveMapDateMode, setLiveMapDateMode] = useState<"today" | "tomorrow" | "custom">("today");
  // Custom mode accepts a range. Both default to today so it behaves like a
  // single-day pick until the operator widens the window.
  const [liveMapCustomFrom, setLiveMapCustomFrom] = useState<string>(() => formatLocalYmd(new Date()));
  const [liveMapCustomTo, setLiveMapCustomTo] = useState<string>(() => formatLocalYmd(new Date()));
  const [liveMapSelectedJobIds, setLiveMapSelectedJobIds] = useState<Set<string>>(() => new Set());
  const [liveMapPartnerFilter, setLiveMapPartnerFilter] = useState<string>("all");
  const [exportOpen, setExportOpen] = useState(false);
  const scheduleVisibleFields = ["reference", "title", "client_name", "property_address", "status", "partner_name", "scheduled_date", "scheduled_start_at", "scheduled_finish_date"];
  const scheduleAllFields = useMemo(
    () => [...new Set(jobs.flatMap((row) => Object.keys(row as unknown as Record<string, unknown>)))],
    [jobs],
  );

  const handleExportFullCsv = useCallback((fields: string[]) => {
    if (jobs.length === 0) {
      return;
    }
    const rows = jobs as unknown as Array<Record<string, unknown>>;
    const finalFields = fields.length > 0 ? fields : [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const csv = buildCsvFromRows(rows, finalFields);
    downloadCsvFile(`schedule-${year}-${String(month + 1).padStart(2, "0")}.csv`, csv);
  }, [jobs, year, month]);

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
        .select("company_name, auth_user_id, trade, trades")
        .not("auth_user_id", "is", null);
      const tradeByAuthUserId = new Map<string, { trade: string; trades: string[] | null }>();
      for (const p of (linkedPartners ?? []) as Array<{
        company_name: string | null;
        auth_user_id: string | null;
        trade: string | null;
        trades: string[] | null;
      }>) {
        if (p.auth_user_id && !byId.has(p.auth_user_id)) {
          byId.set(p.auth_user_id, p.company_name?.trim() || "Partner");
        }
        if (p.auth_user_id) {
          const tr = (p.trade ?? "").trim() || "General";
          tradeByAuthUserId.set(p.auth_user_id, {
            trade: tr,
            trades: Array.isArray(p.trades) && p.trades.length > 0 ? p.trades : null,
          });
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
            const tr = tradeByAuthUserId.get(p.userId);
            return {
              id: p.userId,
              name: p.name,
              latitude: Number(loc.latitude),
              longitude: Number(loc.longitude),
              lastUpdateIso: loc.created_at,
              inactive,
              trade: tr?.trade ?? "General",
              trades: tr?.trades ?? null,
            } as ScheduleLiveMapPoint;
          })
      );

      setLiveMapPoints(rows.filter((r): r is ScheduleLiveMapPoint => r !== null));
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

  useEffect(() => {
    const ids = [...new Set(jobs.map((j) => j.client_id).filter(Boolean))] as string[];
    if (ids.length === 0) {
      setAccountLogoByClientId(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      const supabase = getSupabase();
      const map = await batchResolveClientAccountLogoUrls(supabase, ids);
      if (!cancelled) setAccountLogoByClientId(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [jobs]);

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

  const calendarWeekRowCount = useMemo(() => Math.max(1, calendarDays.length / 7), [calendarDays.length]);

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
      if (!liveMapPointMatchesTradeFilter(p, liveMapTradeFilter)) return false;
      return true;
    });
  }, [liveMapPoints, liveMapSearch, liveMapStatusFilter, liveMapTradeFilter]);

  const liveMapFiltersActive =
    liveMapSearch.trim().length > 0 ||
    liveMapStatusFilter !== "all" ||
    liveMapTradeFilter !== "all" ||
    liveMapRegionPreset !== "fit_all";

  /**
   * Date layer for the live map — always expressed as an inclusive
   * [fromMs, toMs] window so Today/Tomorrow (1 day) and Custom (range)
   * share the same filter code path. Invalid custom inputs fall back to
   * a single-day window on today so the overlay never empties on typos.
   */
  const liveMapSelectedWindow = useMemo<{ fromMs: number; toMs: number }>(() => {
    const today = new Date();
    const todayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    if (liveMapDateMode === "today") return { fromMs: todayMs, toMs: todayMs };
    if (liveMapDateMode === "tomorrow") {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      const ms = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
      return { fromMs: ms, toMs: ms };
    }
    /** Parse yyyy-MM-dd into a local-midnight timestamp, tolerating bad input. */
    const parse = (s: string): number | null => {
      const [yy, mm, dd] = s.split("-").map(Number);
      if (!yy || !mm || !dd) return null;
      return new Date(yy, mm - 1, dd).getTime();
    };
    const a = parse(liveMapCustomFrom) ?? todayMs;
    const b = parse(liveMapCustomTo) ?? a;
    /** Normalise reversed pickers so "From > To" still yields a usable window. */
    return { fromMs: Math.min(a, b), toMs: Math.max(a, b) };
  }, [liveMapDateMode, liveMapCustomFrom, liveMapCustomTo]);

  const liveMapIsRange =
    liveMapDateMode === "custom" && liveMapSelectedWindow.fromMs !== liveMapSelectedWindow.toMs;

  const liveMapSelectedLabel = useMemo(() => {
    const from = new Date(liveMapSelectedWindow.fromMs);
    const to = new Date(liveMapSelectedWindow.toMs);
    const sameDay = liveMapSelectedWindow.fromMs === liveMapSelectedWindow.toMs;
    if (sameDay) {
      return from.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    }
    const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
    if (sameMonth) {
      return `${from.getDate()}–${to.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
    }
    return `${from.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${to.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  }, [liveMapSelectedWindow]);

  /**
   * Jobs overlapping the selected window, with a geocoded location. Uses
   * interval-overlap (jobEnd >= windowFrom AND jobStart <= windowTo) so
   * multi-day jobs show up when any of their days fall in the range.
   * Reuses the already-loaded `jobs` state — no new fetch, no new calc.
   */
  const jobsForSelectedDay = useMemo<Job[]>(() => {
    if (view !== "live_map") return [];
    const { fromMs, toMs } = liveMapSelectedWindow;
    return jobs.filter((j) => {
      const s = jobScheduleYmd(j);
      if (!s) return false;
      const e = jobFinishYmd(j) ?? s;
      const jobStart = new Date(s.y, s.m - 1, s.d).getTime();
      const jobEnd = new Date(e.y, e.m - 1, e.d).getTime();
      if (jobEnd < fromMs || jobStart > toMs) return false;
      if (typeof j.latitude !== "number" || typeof j.longitude !== "number") return false;
      if (liveMapTradeFilter !== "all") {
        const jobTrade = normalizeTypeOfWork(resolveScheduleJobTypeKey(j.title)) || "";
        const wanted = normalizeTypeOfWork(liveMapTradeFilter) || liveMapTradeFilter;
        if (jobTrade !== wanted) return false;
      }
      if (liveMapPartnerFilter !== "all") {
        if (liveMapPartnerFilter === "__unassigned__") {
          if (j.partner_id || j.partner_name) return false;
        } else if (j.partner_id !== liveMapPartnerFilter) {
          return false;
        }
      }
      return true;
    });
  }, [view, jobs, liveMapSelectedWindow, liveMapTradeFilter, liveMapPartnerFilter]);

  /**
   * Per-partner stats used by the hover popup on partner pins:
   *   - completed: lifetime completed jobs within the loaded month window
   *     (good enough proxy for "jobs done" in the ops view — avoids an
   *     extra query and resets monthly alongside the rest of the page data).
   *   - inWindow:  jobs assigned to that partner whose schedule falls in
   *     the currently selected Today / Tomorrow / Custom-range window.
   */
  const partnerStatsById = useMemo(() => {
    const stats = new Map<string, { completed: number; inWindow: number }>();
    const ensure = (id: string) => {
      let s = stats.get(id);
      if (!s) {
        s = { completed: 0, inWindow: 0 };
        stats.set(id, s);
      }
      return s;
    };
    for (const j of jobs) {
      const pid = j.partner_id?.trim();
      if (!pid) continue;
      if (j.status === "completed") ensure(pid).completed += 1;
    }
    for (const j of jobsForSelectedDay) {
      const pid = j.partner_id?.trim();
      if (!pid) continue;
      ensure(pid).inWindow += 1;
    }
    return stats;
  }, [jobs, jobsForSelectedDay]);

  /** Partner points enriched with hover-popup stats (completed / in window).
   *  Kept after partnerStatsById's declaration so the memo can read from it. */
  const partnerPointsForMap = useMemo<ScheduleLiveMapPoint[]>(() => {
    return filteredLiveMapPoints.map((p) => {
      const s = partnerStatsById.get(p.id);
      return {
        ...p,
        jobsCompleted: s?.completed,
        jobsInWindow: s?.inWindow,
      };
    });
  }, [filteredLiveMapPoints, partnerStatsById]);

  /** Unique partner choices for the dispatch partner filter, taken from the
   *  jobs list so ops can narrow the overlay to one partner's day. */
  const liveMapPartnerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const j of jobs) {
      const pid = j.partner_id?.trim();
      if (!pid) continue;
      const name = (j.partner_name ?? "").trim() || "Partner";
      if (!seen.has(pid)) seen.set(pid, name);
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [jobs]);

  const liveMapJobPoints = useMemo<ScheduleLiveMapJobPoint[]>(() => {
    return jobsForSelectedDay.map((j) => ({
      id: j.id,
      latitude: Number(j.latitude ?? 0),
      longitude: Number(j.longitude ?? 0),
      reference: j.reference,
      title: j.title,
      partnerName: j.partner_name?.trim() ? j.partner_name : null,
      clientName: j.client_name?.trim() || undefined,
      propertyAddress: j.property_address,
      statusLabel: statusConfig[j.status]?.label ?? j.status,
      /** Drives the pin colour + icon (red/green/blue/orange) — matches the
       *  Fixfy badge semantics used elsewhere in the app. */
      statusCategory: liveMapCategoryForStatus(j.status),
      tradeLabel: resolveScheduleJobTypeKey(j.title),
      scheduleLine: formatJobScheduleLine(j) ?? "",
    }));
  }, [jobsForSelectedDay]);

  const toggleJobSelection = useCallback((id: string) => {
    setLiveMapSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearJobSelection = useCallback(() => setLiveMapSelectedJobIds(new Set()), []);

  /** Stable set reference for the map overlay so marker re-renders are cheap. */
  const liveMapSelectedJobSet = liveMapSelectedJobIds;
  const liveMapJobsWithLocation = jobsForSelectedDay.length;
  const liveMapJobsMissingLocation = useMemo(() => {
    if (view !== "live_map") return 0;
    const { fromMs, toMs } = liveMapSelectedWindow;
    return jobs.filter((j) => {
      const s = jobScheduleYmd(j);
      if (!s) return false;
      const e = jobFinishYmd(j) ?? s;
      const jobStart = new Date(s.y, s.m - 1, s.d).getTime();
      const jobEnd = new Date(e.y, e.m - 1, e.d).getTime();
      if (jobEnd < fromMs || jobStart > toMs) return false;
      return typeof j.latitude !== "number" || typeof j.longitude !== "number";
    }).length;
  }, [view, jobs, liveMapSelectedWindow]);

  return (
    <PageTransition className="flex min-h-0 flex-col gap-2 overflow-hidden sm:gap-3 h-[calc(100dvh-7rem)] max-h-[calc(100dvh-7rem)] lg:h-[calc(100dvh-8rem)] lg:max-h-[calc(100dvh-8rem)]">
        <PageHeader
          className="shrink-0 flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between"
          title="Schedule & Dispatch"
          subtitle="Manage job scheduling, partner assignments and dispatch."
        >
          <Tabs
            tabs={[
              { id: "calendar", label: "Calendar" },
              { id: "live_map", label: "Live map", count: liveMapPoints.length },
            ]}
            activeTab={view}
            onChange={(id) => setView(id as "calendar" | "live_map")}
            variant="pills"
          />
          <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => setExportOpen(true)}>
            Export
          </Button>
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />}>New Booking</Button>
        </PageHeader>

        {view === "calendar" && (
          <div className="shrink-0 rounded-xl border border-border-light bg-card/60 px-3 py-1.5 sm:px-4 sm:py-2">
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
        )}

        <StaggerContainer className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
          <KpiCard compact title="Jobs this month" value={activeCount} format="number" icon={Briefcase} accent="blue" />
          <KpiCard compact title="In progress" value={inProgressCount} format="number" icon={RefreshCw} accent="emerald" />
          <KpiCard
            compact
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
            descriptionAsTooltip
          />
          <KpiCard
            compact
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

        {view === "calendar" ? (
          <motion.div
            variants={fadeInUp}
            initial="hidden"
            animate="visible"
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          >
            <Card padding="none" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Calendar Header */}
            <div className="flex shrink-0 flex-col gap-2 border-b border-border-light px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-2.5">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start sm:gap-3">
                <button
                  onClick={goPrev}
                  className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-tertiary transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <h3 className="min-w-0 text-center text-sm font-semibold text-text-primary sm:min-w-[140px] sm:text-base">
                  {MONTHS[month]} {year}
                </h3>
                <button
                  onClick={goNext}
                  className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-tertiary transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                {!isToday && (
                  <Button variant="ghost" size="sm" onClick={goToday}>Today</Button>
                )}
              </div>
              <div className="flex items-center justify-center gap-2 sm:justify-end sm:gap-3">
                {loading && (
                  <span className="text-xs text-text-tertiary animate-pulse">Loading...</span>
                )}
                <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary sm:text-xs">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                    <span className="whitespace-nowrap">{jobs.length} jobs this month</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Day Headers */}
            <div className="grid shrink-0 grid-cols-7 border-b border-border-light">
              {DAYS_OF_WEEK.map((day) => (
                <div key={day} className="px-1 py-1.5 text-center text-[10px] font-semibold text-text-tertiary uppercase tracking-wider sm:px-2 sm:text-[11px]">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Grid — rows share remaining height */}
            <div
              className="grid min-h-0 flex-1 grid-cols-7 overflow-hidden"
              style={{ gridTemplateRows: `repeat(${calendarWeekRowCount}, minmax(0, 1fr))` }}
            >
              {calendarDays.map((day, index) => {
                const dayJobs = day ? (jobsByDay[day] || []) : [];
                const isTodayCell = isToday && day === todayDate;
                return (
                  <div
                    key={index}
                    className={`flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-r border-border-light p-1 transition-colors ${
                      isTodayCell ? "bg-primary/[0.03]" : day ? "hover:bg-surface-hover/40" : "bg-surface-hover/20"
                    }`}
                  >
                    {day && (
                      <>
                        <div className="mb-0.5 flex shrink-0 items-center justify-between px-0.5">
                          <span className={`text-[10px] font-medium sm:text-xs ${
                            isTodayCell
                              ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-white sm:h-6 sm:w-6"
                              : "text-text-secondary"
                          }`}>
                            {day}
                          </span>
                          {dayJobs.length > 0 && (
                            <span className="text-[9px] text-text-tertiary sm:text-[10px]">{dayJobs.length}</span>
                          )}
                        </div>
                        <div className="min-h-0 flex-1 space-y-0.5 overflow-hidden min-w-0">
                          {dayJobs.slice(0, 3).map(({ job, segment }, idx) => {
                            const cid = job.client_id?.trim();
                            const accountLogoUrl = cid ? accountLogoByClientId.get(cid) : null;
                            return (
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
                                <span className="flex min-w-0 flex-1 items-center gap-0.5">
                                  {accountLogoUrl ? (
                                    <img
                                      src={accountLogoUrl}
                                      alt=""
                                      className="h-[11px] w-[11px] shrink-0 rounded-[2px] object-contain bg-white/80 ring-1 ring-black/[0.08]"
                                      loading="lazy"
                                      referrerPolicy="no-referrer"
                                    />
                                  ) : null}
                                  <span className="min-w-0 flex-1 truncate">{formatScheduleCalendarBarCompact(job)}</span>
                                </span>
                              </motion.div>
                            );
                          })}
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
          <motion.div
            variants={fadeInUp}
            initial="hidden"
            animate="visible"
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#E4E4E8]"
          >
            <ScheduleLiveMap
              className="flex min-h-0 flex-1 flex-col"
              points={partnerPointsForMap}
              regionPreset={liveMapRegionPreset}
              tradeFilter={liveMapTradeFilter}
              embeddedInCard
              jobPoints={liveMapJobPoints}
              selectedJobIds={liveMapSelectedJobSet}
              onJobMarkerClick={toggleJobSelection}
              toolbarExtra={
                <button
                  type="button"
                  className={LIVE_MAP_TOOLBAR_BTN_CLASS}
                  onClick={() => void loadLiveMap()}
                >
                  <RefreshCw className={cn("h-3 w-3 shrink-0", loadingLiveMap && "animate-spin")} aria-hidden />
                  Refresh
                </button>
              }
              filterOverlay={
                <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[#E4E4E8] bg-white/95 p-2 shadow-md backdrop-blur-sm">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#64748B]" aria-hidden />
                    <input
                      type="search"
                      placeholder="Search partner…"
                      value={liveMapSearch}
                      onChange={(e) => setLiveMapSearch(e.target.value)}
                      aria-label="Filter partners by name"
                      className="h-7 w-[148px] rounded-md border-[0.5px] border-[#D8D8DD] bg-white py-1 pl-6 pr-2 text-[11px] text-[#020040] outline-none focus:ring-2 focus:ring-[#020040]/15"
                    />
                  </div>
                  <div className="relative">
                    <select
                      aria-label="Map area"
                      value={liveMapRegionPreset}
                      onChange={(e) => setLiveMapRegionPreset(e.target.value as LiveMapRegionPreset)}
                      className="h-7 appearance-none rounded-md border-[0.5px] border-[#D8D8DD] bg-white py-1 pl-2 pr-6 text-[11px] font-medium text-[#020040] outline-none"
                    >
                      {LIVE_MAP_REGION_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[#64748B]" aria-hidden />
                  </div>
                  <div className="relative">
                    <select
                      aria-label="Trade filter"
                      value={liveMapTradeFilter}
                      onChange={(e) => setLiveMapTradeFilter(e.target.value)}
                      className="h-7 appearance-none rounded-md border-[0.5px] border-[#D8D8DD] bg-white py-1 pl-2 pr-6 text-[11px] font-medium text-[#020040] outline-none"
                    >
                      {liveMapTradeFilterOptions().map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[#64748B]" aria-hidden />
                  </div>
                  <div className="flex items-center gap-0.5 rounded-md border-[0.5px] border-[#D8D8DD] bg-[#FAFAFB] p-0.5">
                    {(["all", "active", "inactive"] as const).map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setLiveMapStatusFilter(id)}
                        className={cn(
                          "rounded px-2 py-0.5 text-[11px] font-medium transition-colors capitalize",
                          liveMapStatusFilter === id
                            ? "bg-[#020040] text-white"
                            : "text-[#020040] hover:bg-white",
                        )}
                      >
                        {id === "all" ? "All" : id.charAt(0).toUpperCase() + id.slice(1)}
                      </button>
                    ))}
                  </div>
                  {liveMapTradeFilter !== "all" && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-[#EEF2FF] px-2 py-0.5 text-[11px] font-medium text-[#020040]">
                      <Users className="h-3 w-3" aria-hidden />
                      {filteredLiveMapPoints.length} visible
                    </span>
                  )}
                  {filteredLiveMapPoints.length === 0 && liveMapPoints.length > 0 && (
                    <span className="text-[11px] font-medium text-red-500">No partners match</span>
                  )}
                </div>
              }
              bottomLeftOverlay={
                <div className="rounded-xl border border-[#E4E4E8] bg-white/95 px-3 py-2 shadow-md backdrop-blur-sm">
                  <div className="flex items-center gap-3 text-[11px]">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#1D9E75]" aria-hidden />
                      <span className="text-[#64748B]">Active</span>
                      <span className="font-semibold tabular-nums text-[#020040]">{liveActiveCount}</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ED4B00]" aria-hidden />
                      <span className="text-[#64748B]">Inactive</span>
                      <span className="font-semibold tabular-nums text-[#020040]">{liveInactiveCount}</span>
                    </span>
                    {liveMapUpdatedAt && (
                      <span className="text-[10px] text-[#64748B]">
                        · {new Date(liveMapUpdatedAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[#64748B]">
                    {liveMapJobStatusLegend().map((entry) => (
                      <span key={entry.key} className="inline-flex items-center gap-1">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-[3px] ring-1 ring-white/80"
                          style={{ background: entry.color }}
                          aria-hidden
                        />
                        {entry.label}
                      </span>
                    ))}
                  </div>
                </div>
              }
              bottomRightOverlay={
                <div className="max-w-[380px] rounded-xl border border-[#E4E4E8] bg-white/95 px-3 py-2 shadow-md backdrop-blur-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#020040]">
                      <CalIcon className="h-3 w-3 text-[#ED4B00]" aria-hidden />
                      Jobs of the day
                    </span>
                    <div className="inline-flex items-center gap-0.5 rounded-md border-[0.5px] border-[#D8D8DD] bg-[#FAFAFB] p-0.5">
                      {(
                        [
                          { id: "today" as const, label: "Today" },
                          { id: "tomorrow" as const, label: "Tomorrow" },
                          { id: "custom" as const, label: "Custom" },
                        ] as const
                      ).map(({ id, label }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setLiveMapDateMode(id)}
                          className={cn(
                            "rounded-md px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                            liveMapDateMode === id
                              ? "bg-[#ED4B00] text-white"
                              : "border-[0.5px] border-[#D8D8DD] bg-white text-[#020040] hover:bg-white",
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {liveMapDateMode === "custom" && (
                      <div className="inline-flex items-center gap-1">
                        <input
                          type="date"
                          aria-label="Range start"
                          value={liveMapCustomFrom}
                          onChange={(e) => setLiveMapCustomFrom(e.target.value)}
                          max={liveMapCustomTo || undefined}
                          className="h-7 rounded-md border-[0.5px] border-[#D8D8DD] bg-white px-2 text-[11px] text-[#020040] outline-none focus:ring-2 focus:ring-[#020040]/15"
                        />
                        <span className="text-[11px] text-[#64748B]">→</span>
                        <input
                          type="date"
                          aria-label="Range end"
                          value={liveMapCustomTo}
                          onChange={(e) => setLiveMapCustomTo(e.target.value)}
                          min={liveMapCustomFrom || undefined}
                          className="h-7 rounded-md border-[0.5px] border-[#D8D8DD] bg-white px-2 text-[11px] text-[#020040] outline-none focus:ring-2 focus:ring-[#020040]/15"
                        />
                      </div>
                    )}
                    <div className="relative">
                      <select
                        aria-label="Filter jobs by partner"
                        value={liveMapPartnerFilter}
                        onChange={(e) => setLiveMapPartnerFilter(e.target.value)}
                        className="h-7 appearance-none rounded-md border-[0.5px] border-[#D8D8DD] bg-white py-1 pl-2 pr-6 text-[11px] font-medium text-[#020040] outline-none"
                      >
                        <option value="all">All partners</option>
                        <option value="__unassigned__">Unassigned only</option>
                        {liveMapPartnerOptions.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[#64748B]" aria-hidden />
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-md bg-[#FFF4ED] px-2 py-0.5 text-[11px] font-medium text-[#ED4B00]">
                      <Briefcase className="h-3 w-3" aria-hidden />
                      {liveMapJobsWithLocation} {liveMapJobsWithLocation === 1 ? "job" : "jobs"} · {liveMapSelectedLabel}
                    </span>
                    {liveMapJobsMissingLocation > 0 && (
                      <span
                        className="inline-flex items-center gap-1 rounded-md bg-[#FEF3C7] px-2 py-0.5 text-[11px] font-medium text-[#92400E]"
                        title="These jobs have no geocoded address so they can't be placed on the map."
                      >
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        {liveMapJobsMissingLocation} no location
                      </span>
                    )}
                    {liveMapSelectedJobIds.size > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-[#020040] px-2.5 py-0.5 text-[11px] font-semibold text-white">
                        {liveMapSelectedJobIds.size} selected for dispatch
                        <button
                          type="button"
                          onClick={clearJobSelection}
                          className="ml-0.5 rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-white/25"
                        >
                          Clear
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              }
            />
          </motion.div>
        )}

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
      <ExportCsvModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        allFields={scheduleAllFields}
        visibleFields={scheduleVisibleFields}
        onConfirm={async (fields) => {
          handleExportFullCsv(fields);
        }}
      />
    </PageTransition>
  );
}
