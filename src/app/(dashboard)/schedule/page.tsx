"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { PageTransition } from "@/components/layout/page-transition";
import { BeaconHeader, type BeaconView } from "@/components/beacon/beacon-header";
import { BeaconKanban } from "@/components/beacon/beacon-kanban";
import { BeaconList } from "@/components/beacon/beacon-list";
import {
  type BeaconFilters,
  DEFAULT_BEACON_FILTERS,
  getDateRangeForMode,
  resolveAccountClientIds,
} from "@/components/beacon/beacon-filters";
import { getDrivingRoute, formatDuration, formatDistanceMiles, type DrivingRoute } from "@/lib/mapbox-directions";
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
import { normalizeLiveMapCoordinate } from "@/lib/live-map-coordinate";
import { normalizeTypeOfWork } from "@/lib/type-of-work";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import { Briefcase, AlertTriangle, Users, RefreshCw, ChevronDown, Calendar as CalIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { getLatestLocation, getTeamMembers } from "@/services/partner-detail";
import type { Job } from "@/types/database";
import {
  formatJobScheduleLine,
  formatLocalYmd,
  jobFinishYmd,
  jobIntersectsLocalMonth,
  jobScheduleYmd,
} from "@/lib/schedule-calendar";
import { resolveScheduleJobTypeKey } from "@/lib/schedule-job-type-style";
import { fetchScheduleCalendarJobsForMonth } from "@/lib/fetch-schedule-calendar-jobs";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
import { JOB_STATUS_BADGE_VARIANT } from "@/lib/job-status-ui";
import type { BadgeVariant } from "@/components/ui/badge";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";

const LIVE_MAP_INACTIVE_MINUTES = 15;

const LIVE_MAP_JOB_LAYER_HINT_BASE =
  "Map area / trade filters do not narrow job pins — overlay uses all jobs overlapping the selected date layer.";

const LIVE_MAP_REGION_OPTIONS: { value: LiveMapRegionPreset; label: string }[] = [
  { value: "london", label: "London" },
  { value: "fit_all", label: "All" },
  { value: "uk", label: "United Kingdom" },
  { value: "europe", label: "Europe" },
];

const statusConfig: Record<string, { label: string; variant: BadgeVariant }> = {
  unassigned: { label: "Unassigned", variant: JOB_STATUS_BADGE_VARIANT.unassigned },
  auto_assigning: { label: "Assigning", variant: JOB_STATUS_BADGE_VARIANT.auto_assigning },
  scheduled: { label: "Scheduled", variant: JOB_STATUS_BADGE_VARIANT.scheduled },
  late: { label: "Late", variant: JOB_STATUS_BADGE_VARIANT.late },
  in_progress: { label: "In progress", variant: JOB_STATUS_BADGE_VARIANT.in_progress },
  on_hold: { label: "On hold", variant: JOB_STATUS_BADGE_VARIANT.on_hold },
  final_check: { label: "Final check", variant: JOB_STATUS_BADGE_VARIANT.final_check },
  awaiting_payment: { label: "Awaiting payment", variant: JOB_STATUS_BADGE_VARIANT.awaiting_payment },
  need_attention: { label: "Need attention", variant: JOB_STATUS_BADGE_VARIANT.need_attention },
  completed: { label: "Completed", variant: JOB_STATUS_BADGE_VARIANT.completed },
  cancelled: { label: "Cancelled", variant: JOB_STATUS_BADGE_VARIANT.cancelled },
  deleted: { label: "Deleted", variant: JOB_STATUS_BADGE_VARIANT.deleted },
};

function liveMapCategoryForStatus(status: string): LiveMapJobStatusCategory {
  if (status === "unassigned" || status === "auto_assigning") return "unassigned";
  if (status === "scheduled" || status === "late") return "scheduled";
  if (
    status.startsWith("in_progress") ||
    status === "final_check" ||
    status === "on_hold" ||
    status === "need_attention"
  ) {
    return "in_progress";
  }
  return "attention";
}

export default function SchedulePage() {
  const [view, setView] = useState<BeaconView>("kanban");
  const [beaconFilters, setBeaconFilters] = useState<BeaconFilters>(DEFAULT_BEACON_FILTERS);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  /** Live count scoped to the date filter the user picked (Today/Week/Month/QTD/All).
   *  Live = unassigned + scheduled + in_progress; late is a warning label, not a
   *  live state on its own. Mirrors the Pulse "Live Now" semantic. */
  const [realTimeLiveCount, setRealTimeLiveCount] = useState(0);
  const loadRealTimeLiveCount = useCallback(async () => {
    const supabase = getSupabase();
    let query = supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["unassigned", "scheduled", "in_progress"])
      .is("deleted_at", null);
    const range = getDateRangeForMode(beaconFilters);
    if (range) {
      query = query
        .gte("scheduled_start_at", range.fromIso)
        .lte("scheduled_start_at", range.toIso);
    }
    const { count } = await query;
    setRealTimeLiveCount(count ?? 0);
  }, [beaconFilters]);
  useEffect(() => {
    void loadRealTimeLiveCount();
  }, [loadRealTimeLiveCount]);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void loadRealTimeLiveCount();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loadRealTimeLiveCount]);
  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const d = new Date();
      const list = await fetchScheduleCalendarJobsForMonth(d.getFullYear(), d.getMonth());
      setJobs(list);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  const [liveMapPoints, setLiveMapPoints] = useState<ScheduleLiveMapPoint[]>([]);
  const [loadingLiveMap, setLoadingLiveMap] = useState(false);
  const [liveMapUpdatedAt, setLiveMapUpdatedAt] = useState<string | null>(null);
  const [liveMapRegionPreset, setLiveMapRegionPreset] = useState<LiveMapRegionPreset>("london");
  const [liveMapTradeFilter, setLiveMapTradeFilter] = useState<"all" | string>("all");
  const [liveMapDateMode, setLiveMapDateMode] = useState<"today" | "tomorrow" | "custom">("today");
  const [liveMapCustomFrom, setLiveMapCustomFrom] = useState<string>(() => formatLocalYmd(new Date()));
  const [liveMapCustomTo, setLiveMapCustomTo] = useState<string>(() => formatLocalYmd(new Date()));
  const [liveMapSelectedJobIds, setLiveMapSelectedJobIds] = useState<Set<string>>(() => new Set());
  const [liveMapPartnerFilter, setLiveMapPartnerFilter] = useState<string>("all");
  /** "all" · account_id. Filters job pins by clients.source_account_id (partner pins stay visible). */
  const [liveMapAccountFilter, setLiveMapAccountFilter] = useState<string>("all");
  const [liveMapAccountsList, setLiveMapAccountsList] = useState<{ id: string; name: string }[]>([]);
  /** Resolved client_ids for the active account filter (null when filter = "all"). */
  const [liveMapAccountClientIds, setLiveMapAccountClientIds] = useState<Set<string> | null>(null);
  /** Selected partner for the "route to next job" affordance + the computed route. */
  const [liveMapRoutedPartnerId, setLiveMapRoutedPartnerId] = useState<string | null>(null);
  const [liveMapRoute, setLiveMapRoute] = useState<DrivingRoute | null>(null);
  const [liveMapRouteJobId, setLiveMapRouteJobId] = useState<string | null>(null);
  const [liveMapRouteLoading, setLiveMapRouteLoading] = useState(false);
  /** Matches Live View trade filter + job title parsing to Admin → Services catalog names. */
  const [serviceCatalogTypeNames, setServiceCatalogTypeNames] = useState<string[]>([]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    void listCatalogServicesForPicker()
      .then((rows) =>
        setServiceCatalogTypeNames(
          rows.map((r) => (typeof r.name === "string" ? r.name.trim() : "")).filter(Boolean),
        ),
      )
      .catch(() => setServiceCatalogTypeNames([]));
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void loadJobs();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loadJobs]);

  const loadLiveMap = useCallback(async () => {
    setLoadingLiveMap(true);
    const supabase = getSupabase();
    try {
      const members = await getTeamMembers();
      const byId = new Map<string, string>();
      for (const m of members) {
        if (m?.id) byId.set(m.id, m.full_name?.trim() || "Partner");
      }

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
          const normalized = normalizeLiveMapCoordinate(loc.latitude, loc.longitude);
          if (!normalized) return null;
          const minutesSincePing = Math.floor((nowMs - new Date(loc.created_at).getTime()) / 60000);
          const inactive = !loc.is_active || minutesSincePing > LIVE_MAP_INACTIVE_MINUTES;
          const tr = tradeByAuthUserId.get(p.userId);
          return {
            id: p.userId,
            name: p.name,
            latitude: normalized.latitude,
            longitude: normalized.longitude,
            lastUpdateIso: loc.created_at,
            inactive,
            trade: tr?.trade ?? "General",
            trades: tr?.trades ?? null,
          } as ScheduleLiveMapPoint;
        }),
      );

      setLiveMapPoints(rows.filter((r): r is ScheduleLiveMapPoint => r !== null));
      setLiveMapUpdatedAt(new Date().toISOString());
    } catch {
      /* ignore */
    } finally {
      setLoadingLiveMap(false);
    }
  }, []);

  useEffect(() => {
    loadLiveMap();
    const timer = window.setInterval(() => {
      void loadLiveMap();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadLiveMap]);

  // Realtime: any change to `user_locations` triggers a debounced reload so
  // partner pins move within ~1s of a heartbeat instead of waiting for the
  // 60s poll. The poll stays on as a defensive heartbeat.
  useEffect(() => {
    const supabase = getSupabase();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void loadLiveMap(), 500);
    };
    const channel = supabase
      .channel("schedule_live_map_user_locations")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_locations" }, schedule)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [loadLiveMap]);

  // Load corporate accounts once for the Account picker.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = getSupabase();
      const { data } = await supabase
        .from("accounts")
        .select("id, name")
        .order("name", { ascending: true })
        .limit(2000);
      if (cancelled) return;
      setLiveMapAccountsList(
        ((data ?? []) as { id: string; name: string | null }[])
          .map((r) => ({ id: r.id, name: r.name?.trim() ?? "" }))
          .filter((a) => a.id && a.name),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve the account filter to a client_id set used downstream when
  // narrowing job pins. `null` = no account filter; empty Set = account has
  // no clients (caller should render zero job pins).
  useEffect(() => {
    let cancelled = false;
    if (liveMapAccountFilter === "all") {
      setLiveMapAccountClientIds(null);
      return;
    }
    void (async () => {
      const ids = await resolveAccountClientIds(liveMapAccountFilter);
      if (cancelled) return;
      setLiveMapAccountClientIds(ids ? new Set(ids) : new Set());
    })();
    return () => {
      cancelled = true;
    };
  }, [liveMapAccountFilter]);

  const anchorCal = useMemo(() => {
    const t = new Date();
    return { y: t.getFullYear(), m: t.getMonth() };
  }, []);

  const jobsTouchingCalendarMonth = useMemo(
    () => jobs.filter((j) => jobIntersectsLocalMonth(j, anchorCal.y, anchorCal.m)),
    [jobs, anchorCal.y, anchorCal.m],
  );

  const filteredLiveMapPoints = useMemo(() => {
    return liveMapPoints.filter((p) => liveMapPointMatchesTradeFilter(p, liveMapTradeFilter));
  }, [liveMapPoints, liveMapTradeFilter]);

  const liveMapJobLayerHint = useMemo(() => {
    if (liveMapTradeFilter !== "all") {
      return `${LIVE_MAP_JOB_LAYER_HINT_BASE}\nTrade still narrows which job trades appear when a trade filter is applied.`;
    }
    return LIVE_MAP_JOB_LAYER_HINT_BASE;
  }, [liveMapTradeFilter]);

  const liveSelectedWindow = useMemo<{ fromMs: number; toMs: number }>(() => {
    const today = new Date();
    const todayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    if (liveMapDateMode === "today") return { fromMs: todayMs, toMs: todayMs };
    if (liveMapDateMode === "tomorrow") {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      const ms = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
      return { fromMs: ms, toMs: ms };
    }
    const parse = (s: string): number | null => {
      const [yy, mm, dd] = s.split("-").map(Number);
      if (!yy || !mm || !dd) return null;
      return new Date(yy, mm - 1, dd).getTime();
    };
    const a = parse(liveMapCustomFrom) ?? todayMs;
    const b = parse(liveMapCustomTo) ?? a;
    return { fromMs: Math.min(a, b), toMs: Math.max(a, b) };
  }, [liveMapDateMode, liveMapCustomFrom, liveMapCustomTo]);

  const liveMapSelectedLabel = useMemo(() => {
    const from = new Date(liveSelectedWindow.fromMs);
    const to = new Date(liveSelectedWindow.toMs);
    const sameDay = liveSelectedWindow.fromMs === liveSelectedWindow.toMs;
    if (sameDay) {
      return from.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    }
    const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
    if (sameMonth) {
      return `${from.getDate()}–${to.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
    }
    return `${from.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${to.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    })}`;
  }, [liveSelectedWindow]);

  const jobsForSelectedDay = useMemo<Job[]>(() => {
    const { fromMs, toMs } = liveSelectedWindow;
    return jobs.filter((j) => {
      const isLiveOpsVisible =
        j.status !== "completed" &&
        j.status !== "awaiting_payment" &&
        j.status !== "cancelled" &&
        j.status !== "deleted";
      if (!isLiveOpsVisible) return false;
      const s = jobScheduleYmd(j);
      if (!s) return false;
      const e = jobFinishYmd(j) ?? s;
      const jobStart = new Date(s.y, s.m - 1, s.d).getTime();
      const jobEnd = new Date(e.y, e.m - 1, e.d).getTime();
      if (jobEnd < fromMs || jobStart > toMs) return false;
      if (!normalizeLiveMapCoordinate(j.latitude, j.longitude)) return false;
      if (liveMapTradeFilter !== "all") {
        const jobTrade =
          normalizeTypeOfWork(resolveScheduleJobTypeKey(j.title, serviceCatalogTypeNames)) || "";
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
  }, [jobs, liveSelectedWindow, liveMapTradeFilter, liveMapPartnerFilter, serviceCatalogTypeNames]);

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
    for (const j of jobsTouchingCalendarMonth) {
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
  }, [jobsTouchingCalendarMonth, jobsForSelectedDay]);

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
    const points: ScheduleLiveMapJobPoint[] = [];
    for (const j of jobsForSelectedDay) {
      const normalized = normalizeLiveMapCoordinate(j.latitude, j.longitude);
      if (!normalized) continue;
      // Account filter: drop jobs whose client_id isn't in the resolved set.
      // null set = no account filter; empty set = account has no clients.
      if (liveMapAccountClientIds !== null) {
        if (!j.client_id || !liveMapAccountClientIds.has(j.client_id)) continue;
      }
      points.push({
        id: j.id,
        latitude: normalized.latitude,
        longitude: normalized.longitude,
        reference: j.reference,
        title: j.title,
        partnerName: j.partner_name?.trim() ? j.partner_name : null,
        clientName: j.client_name?.trim() || undefined,
        propertyAddress: j.property_address,
        statusLabel: statusConfig[j.status]?.label ?? j.status,
        statusCategory: liveMapCategoryForStatus(j.status),
        tradeLabel: resolveScheduleJobTypeKey(j.title, serviceCatalogTypeNames),
        scheduleLine: formatJobScheduleLine(j) ?? "",
      });
    }
    return points;
  }, [jobsForSelectedDay, serviceCatalogTypeNames, liveMapAccountClientIds]);

  /** Compute the next eligible job for the routed partner and fetch the driving
   *  route from Mapbox. Runs whenever the user clicks a partner pin (or the
   *  underlying data changes while a partner is selected). */
  useEffect(() => {
    if (!liveMapRoutedPartnerId) {
      setLiveMapRoute(null);
      setLiveMapRouteJobId(null);
      return;
    }
    const partner = liveMapPoints.find((p) => p.id === liveMapRoutedPartnerId);
    if (!partner) {
      setLiveMapRoute(null);
      setLiveMapRouteJobId(null);
      return;
    }
    // Next eligible job: earliest scheduled_start_at where partner matches and
    // the job hasn't started yet (status in {scheduled, late, unassigned}).
    const candidates = jobs
      .filter((j) => {
        if (j.partner_id !== liveMapRoutedPartnerId) return false;
        if (
          j.status !== "scheduled" &&
          j.status !== "late" &&
          j.status !== "unassigned" &&
          j.status !== "auto_assigning"
        ) {
          return false;
        }
        if (typeof j.latitude !== "number" || typeof j.longitude !== "number") return false;
        if (!j.scheduled_start_at) return false;
        return true;
      })
      .sort(
        (a, b) =>
          new Date(a.scheduled_start_at ?? 0).getTime() -
          new Date(b.scheduled_start_at ?? 0).getTime(),
      );
    const nextJob = candidates[0];
    if (!nextJob) {
      setLiveMapRoute(null);
      setLiveMapRouteJobId(null);
      return;
    }
    let cancelled = false;
    setLiveMapRouteLoading(true);
    void (async () => {
      const route = await getDrivingRoute(
        { latitude: partner.latitude, longitude: partner.longitude },
        { latitude: nextJob.latitude as number, longitude: nextJob.longitude as number },
      );
      if (cancelled) return;
      setLiveMapRoute(route);
      setLiveMapRouteJobId(nextJob.id);
      setLiveMapRouteLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [liveMapRoutedPartnerId, liveMapPoints, jobs]);

  const handlePartnerMarkerClick = useCallback((partnerId: string) => {
    setLiveMapRoutedPartnerId((cur) => (cur === partnerId ? null : partnerId));
  }, []);

  const clearRoute = useCallback(() => {
    setLiveMapRoutedPartnerId(null);
  }, []);

  const toggleJobSelection = useCallback((id: string) => {
    setLiveMapSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearJobSelection = useCallback(() => setLiveMapSelectedJobIds(new Set()), []);

  const liveMapSelectedJobSet = liveMapSelectedJobIds;
  const liveMapJobsWithLocation = jobsForSelectedDay.length;
  const liveMapJobsMissingLocation = useMemo(() => {
    const { fromMs, toMs } = liveSelectedWindow;
    return jobs.filter((j) => {
      const s = jobScheduleYmd(j);
      if (!s) return false;
      const e = jobFinishYmd(j) ?? s;
      const jobStart = new Date(s.y, s.m - 1, s.d).getTime();
      const jobEnd = new Date(e.y, e.m - 1, e.d).getTime();
      if (jobEnd < fromMs || jobStart > toMs) return false;
      return typeof j.latitude !== "number" || typeof j.longitude !== "number";
    }).length;
  }, [jobs, liveSelectedWindow]);

  const liveActiveCount = useMemo(() => liveMapPoints.filter((p) => !p.inactive).length, [liveMapPoints]);
  const liveInactiveCount = useMemo(() => liveMapPoints.filter((p) => p.inactive).length, [liveMapPoints]);
  // Mirrors Pulse "Live Now": real-time count, full status set
  // (in_progress + late + final_check), no period filter.
  const beaconLiveCount = realTimeLiveCount;

  return (
    <PageTransition
      className={cn(
        "flex flex-col min-w-0 gap-4",
        view === "map" &&
          "min-h-0 overflow-hidden gap-2 sm:gap-3 h-[calc(100dvh-7rem)] max-h-[calc(100dvh-7rem)] lg:h-[calc(100dvh-8rem)] lg:max-h-[calc(100dvh-8rem)]",
      )}
    >
      <BeaconHeader
        view={view}
        onViewChange={setView}
        liveCount={beaconLiveCount}
        filters={beaconFilters}
        onFiltersChange={setBeaconFilters}
      />

      {view === "list" && <BeaconList filters={beaconFilters} />}
      {view === "kanban" && <BeaconKanban filters={beaconFilters} />}

      {view === "map" && loading && jobs.length === 0 ? (
        <p className="shrink-0 text-xs text-text-tertiary">Loading jobs for map overlays…</p>
      ) : null}

      {view === "map" && (
      <motion.div
        variants={fadeInUp}
        initial="hidden"
        animate="visible"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-fx-line"
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
          onPartnerMarkerClick={handlePartnerMarkerClick}
          routeGeometry={liveMapRoute?.geometry ?? null}
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
            <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-1.5 rounded-xl border border-[#E4E4E8] bg-white/95 px-2 py-1.5 shadow-md backdrop-blur-sm sm:gap-2 sm:py-2">
              <div className="relative">
                <select
                  aria-label="Map area"
                  value={liveMapRegionPreset}
                  onChange={(e) => setLiveMapRegionPreset(e.target.value as LiveMapRegionPreset)}
                  className="h-7 min-w-[110px] appearance-none rounded-md border-[0.5px] border-[#D8D8DD] bg-white py-1 pl-2 pr-6 text-[11px] font-medium text-[#020040] outline-none"
                >
                  {LIVE_MAP_REGION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[#64748B]" aria-hidden />
              </div>
              <div className="relative">
                <select
                  aria-label="Trade filter"
                  value={liveMapTradeFilter}
                  onChange={(e) => setLiveMapTradeFilter(e.target.value)}
                  className="h-7 min-w-[118px] appearance-none rounded-md border-[0.5px] border-[#D8D8DD] bg-white py-1 pl-2 pr-6 text-[11px] font-medium text-[#020040] outline-none"
                >
                  {liveMapTradeFilterOptions(serviceCatalogTypeNames).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[#64748B]" aria-hidden />
              </div>
              <div className="relative">
                <select
                  aria-label="Account filter"
                  value={liveMapAccountFilter}
                  onChange={(e) => setLiveMapAccountFilter(e.target.value)}
                  className="h-7 min-w-[130px] appearance-none rounded-md border-[0.5px] border-[#D8D8DD] bg-white py-1 pl-2 pr-6 text-[11px] font-medium text-[#020040] outline-none"
                >
                  <option value="all">All accounts</option>
                  {liveMapAccountsList.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[#64748B]" aria-hidden />
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
            <div className="flex flex-col gap-2">
              {liveMapRoutedPartnerId ? (() => {
                const partner = liveMapPoints.find((p) => p.id === liveMapRoutedPartnerId);
                const job = liveMapRouteJobId ? jobs.find((j) => j.id === liveMapRouteJobId) : null;
                const arrivalEndMs = job?.scheduled_end_at ? new Date(job.scheduled_end_at).getTime() : null;
                const etaMs = liveMapRoute ? Date.now() + liveMapRoute.durationSec * 1000 : null;
                const willMissWindow = arrivalEndMs && etaMs ? etaMs > arrivalEndMs : false;
                return (
                  <div className="w-[300px] max-w-[92vw] rounded-xl border border-[#E4E4E8] bg-white/95 px-3 py-2.5 shadow-md backdrop-blur-sm space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#ED4B00]">Route · next job</p>
                        <p className="mt-0.5 text-[12.5px] font-semibold text-[#020040] truncate">
                          {partner?.name ?? "Partner"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={clearRoute}
                        className="text-[10px] font-medium text-[#64748B] hover:text-[#020040]"
                      >
                        Clear ✕
                      </button>
                    </div>
                    {liveMapRouteLoading ? (
                      <p className="text-[11px] text-[#64748B]">Calculating route…</p>
                    ) : !job ? (
                      <p className="text-[11px] text-[#64748B]">No upcoming job assigned to this partner.</p>
                    ) : (
                      <>
                        <div className="rounded-md border border-[#E4E4E8] bg-[#FAFAFB] px-2 py-1.5 text-[11px] leading-snug">
                          <p className="font-mono text-[10px] text-[#64748B] tracking-[0.04em]">{job.reference}</p>
                          <p className="font-medium text-[#020040] truncate">{job.title}</p>
                          {job.scheduled_start_at ? (
                            <p className="mt-0.5 text-[10.5px] text-[#64748B]">
                              Arrival {new Date(job.scheduled_start_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}
                              {job.scheduled_end_at ? `–${new Date(job.scheduled_end_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}` : ""}
                              {job.client_name ? ` · ${job.client_name}` : ""}
                            </p>
                          ) : null}
                          {job.property_address ? (
                            <p className="text-[10.5px] text-[#64748B] truncate">{job.property_address}</p>
                          ) : null}
                        </div>
                        {liveMapRoute ? (
                          <div className={cn(
                            "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[11px]",
                            willMissWindow ? "bg-[#FEE2E2] text-[#991B1B]" : "bg-[#ECFDF5] text-[#065F46]",
                          )}>
                            <span className="font-semibold">
                              {willMissWindow ? "⚠ ETA past window" : "On track"}
                            </span>
                            <span className="font-mono tabular-nums">
                              {formatDuration(liveMapRoute.durationSec)} · {formatDistanceMiles(liveMapRoute.distanceM)}
                            </span>
                          </div>
                        ) : (
                          <p className="text-[11px] text-[#64748B]">No driving route available.</p>
                        )}
                      </>
                    )}
                  </div>
                );
              })() : null}
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
                {liveMapUpdatedAt ? (
                  <span className="text-[10px] text-[#64748B]">
                    · {new Date(liveMapUpdatedAt).toLocaleTimeString()}
                  </span>
                ) : null}
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
            </div>
          }
          bottomRightOverlay={
            <div className="w-full sm:max-w-[380px] rounded-xl border border-[#E4E4E8] bg-white/95 px-3 py-2 shadow-md backdrop-blur-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#020040]">
                  <CalIcon className="h-3 w-3 text-[#ED4B00]" aria-hidden />
                  Jobs of the day
                  <FixfyHintIcon text={liveMapJobLayerHint} />
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
                        liveMapDateMode === id ? "bg-[#ED4B00] text-white" : "border-[0.5px] border-[#D8D8DD] bg-white text-[#020040] hover:bg-white",
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
                      className="h-7 rounded-md border-[0.5px] border-[#D8D8DD] bg-white px-2 text-[11px] text-[#020040] outline-none focus:ring-2 focus:ring-[#020040]/15"
                    />
                    <span className="text-[11px] text-[#64748B]">→</span>
                    <input
                      type="date"
                      aria-label="Range end"
                      value={liveMapCustomTo}
                      onChange={(e) => setLiveMapCustomTo(e.target.value)}
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
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
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
    </PageTransition>
  );
}
