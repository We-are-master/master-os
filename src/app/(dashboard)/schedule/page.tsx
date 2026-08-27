"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
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
import { getDrivingRouteMulti, type DrivingRoute } from "@/lib/mapbox-directions";
import { LiveMapDayRoutePanel, type DayRouteData, type DayRouteStop } from "@/components/dashboard/live-map-day-route-panel";
import { AssignPartnerModal } from "@/components/jobs/assign-partner-modal";
import {
  ScheduleLiveMap,
  LIVE_MAP_TOOLBAR_BTN_CLASS,
  type LiveMapRegionPreset,
  type ScheduleLiveMapJobPoint,
  type ScheduleLiveMapPoint,
} from "@/components/dashboard/schedule-live-map";
import {
  liveMapJobStatusColor,
  type LiveMapJobStatusCategory,
} from "@/components/dashboard/live-map-marker-icons";
import {
  LiveMapCoverageScout,
  type LiveMapCoverageSearchState,
  type LiveMapEntityType,
} from "@/components/dashboard/live-map-coverage-scout";
import { LiveMapPartnersPanel } from "@/components/dashboard/live-map-partners-panel";
import { LiveMapJobsPanel } from "@/components/dashboard/live-map-jobs-panel";
import {
  computePartnerStatus,
  type LiveMapPartnerStatus,
} from "@/lib/live-map-partner-status";
import { liveMapPointMatchesTradeFilter } from "@/lib/live-map-trade-filter";
import { normalizeLiveMapCoordinate } from "@/lib/live-map-coordinate";
import { normalizeTypeOfWork } from "@/lib/type-of-work";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import { MapPin, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { useBeaconJobsRealtime } from "@/hooks/use-beacon-jobs-realtime";
import {
  activePartnersCoveringTarget,
  type PartnerCoverageRow,
} from "@/lib/live-map-coverage-match";
import { getLatestLocation } from "@/services/partner-detail";
import { resolveJobGeocode } from "@/lib/job-geocode-client";
import {
  resolvePartnerHomeMapCoordinates,
} from "@/lib/partner-home-map-coordinates";
import type { CatalogService, Job } from "@/types/database";
import {
  formatJobScheduleLine,
  jobFinishYmd,
  jobIntersectsLocalMonth,
  jobScheduleYmd,
} from "@/lib/schedule-calendar";
import { resolveScheduleJobTypeKey } from "@/lib/schedule-job-type-style";
import { fetchScheduleCalendarJobsForMonth } from "@/lib/fetch-schedule-calendar-jobs";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
import { formatPartnerPrimaryTradeLabel, partnerTradesForDisplay } from "@/lib/partner-trades-display";
import { JOB_STATUS_BADGE_VARIANT } from "@/lib/job-status-ui";
import type { BadgeVariant } from "@/components/ui/badge";

const LIVE_MAP_INACTIVE_MINUTES = 15;

/** Stable empties — a fresh [] each render would rebuild the map layers. */
const EMPTY_PARTNER_POINTS: ScheduleLiveMapPoint[] = [];
const EMPTY_JOB_POINTS: ScheduleLiveMapJobPoint[] = [];

const COVERAGE_PARTNER_SELECT =
  "id, company_name, contact_name, trade, trades, catalog_service_ids, status, auth_user_id, coverage_mode, service_radius_miles, coverage_latitude, coverage_longitude, coverage_base_postcode, included_postcodes, coverage_cities, uk_coverage_regions, excluded_postcodes, location";

const DATE_MODE_LABEL: Record<string, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  week: "This week",
  month: "This month",
  qtd: "Quarter to date",
  all: "All time",
  custom: "Custom range",
};

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

/** Raw partner location loaded from Supabase — status is computed later from
 *  jobs + heartbeat freshness, so it lives outside the loader. */
type RawLiveMapPoint = Omit<ScheduleLiveMapPoint, "status"> & { inactive: boolean };

type ActivePartnerMapRow = {
  id: string;
  company_name: string | null;
  auth_user_id: string | null;
  trade: string | null;
  trades: string[] | null;
  catalog_service_ids: string[] | null;
  partner_address: string | null;
  partner_address_latitude: number | null;
  partner_address_longitude: number | null;
  coverage_latitude: number | null;
  coverage_longitude: number | null;
  coverage_base_postcode: string | null;
  included_postcodes: string[] | null;
  coverage_cities: string[] | null;
  service_radius_miles: number | null;
};

const LIVE_MAP_PARTNER_SELECT =
  "id, company_name, auth_user_id, trade, trades, catalog_service_ids, partner_address, partner_address_latitude, partner_address_longitude, coverage_latitude, coverage_longitude, coverage_base_postcode, included_postcodes, coverage_cities, service_radius_miles";

async function resolveActivePartnerMapPoint(
  partner: ActivePartnerMapRow,
  nowMs: number,
  catalog: readonly CatalogService[],
): Promise<RawLiveMapPoint> {
  const mapId = partner.auth_user_id?.trim() || partner.id;
  const name = partner.company_name?.trim() || "Partner";
  const trade = formatPartnerPrimaryTradeLabel(partner, catalog);
  const trades = partnerTradesForDisplay(partner, catalog);

  const homeCoords = await resolvePartnerHomeMapCoordinates(partner, resolveJobGeocode);
  const latitude = homeCoords.latitude;
  const longitude = homeCoords.longitude;

  let lastUpdateIso = new Date().toISOString();
  let inactive = true;

  const authUserId = partner.auth_user_id?.trim();
  if (authUserId) {
    const loc = await getLatestLocation(authUserId);
    if (loc) {
      lastUpdateIso = loc.created_at;
      const minutesSincePing = Math.floor((nowMs - new Date(loc.created_at).getTime()) / 60000);
      inactive = !loc.is_active || minutesSincePing > LIVE_MAP_INACTIVE_MINUTES;
    }
  }

  return {
    id: mapId,
    name,
    latitude,
    longitude,
    lastUpdateIso,
    inactive,
    trade,
    trades: trades.length > 0 ? trades : null,
  };
}

function liveMapCategoryForStatus(status: string): LiveMapJobStatusCategory {
  if (status === "completed" || status === "awaiting_payment") return "completed";
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

const ACTIVE_PARTNER_JOB_STATUSES = new Set([
  "in_progress",
  "late",
  "final_check",
  "on_hold",
  "need_attention",
]);
const UPCOMING_PARTNER_JOB_STATUSES = new Set(["scheduled", "auto_assigning", "unassigned"]);

/** Partner ring colour = active/upcoming job status; white when idle. */
function partnerJobStrokeColor(partnerId: string, jobs: Job[]): string {
  const mine = jobs.filter((j) => j.partner_id === partnerId);
  for (const j of mine) {
    if (ACTIVE_PARTNER_JOB_STATUSES.has(j.status) || j.status.startsWith("in_progress")) {
      return liveMapJobStatusColor(liveMapCategoryForStatus(j.status));
    }
  }
  for (const j of mine) {
    if (UPCOMING_PARTNER_JOB_STATUSES.has(j.status)) {
      return liveMapJobStatusColor(liveMapCategoryForStatus(j.status));
    }
  }
  return "#FFFFFF";
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

  const [liveMapPoints, setLiveMapPoints] = useState<RawLiveMapPoint[]>([]);
  const [loadingLiveMap, setLoadingLiveMap] = useState(false);
  const [liveMapUpdatedAt, setLiveMapUpdatedAt] = useState<string | null>(null);
  const liveMapRegionPreset: LiveMapRegionPreset = "london";
  const [liveMapTradeFilter, setLiveMapTradeFilter] = useState<"all" | string>("all");
  /** What the map draws: jobs, partners, or both. */
  const [liveMapEntityType, setLiveMapEntityType] = useState<LiveMapEntityType>("both");
  const showPartnersOnMap = liveMapEntityType !== "jobs";
  const showJobsOnMap = liveMapEntityType !== "partners";
  const [coveragePartners, setCoveragePartners] = useState<PartnerCoverageRow[]>([]);
  const [coverageDraft, setCoverageDraft] = useState<{
    target: LiveMapCoverageSearchState["target"];
    radiusMiles: number;
  } | null>(null);
  const [recentJobIds, setRecentJobIds] = useState<Set<string>>(() => new Set());
  const prevUnassignedJobIdsRef = useRef<Set<string>>(new Set());
  const didInitRecentJobsRef = useRef(false);
  const [liveMapSelectedJobIds, setLiveMapSelectedJobIds] = useState<Set<string>>(() => new Set());
  /** Resolved client_ids for the active account filter (null when filter = "all"). */
  const [liveMapAccountClientIds, setLiveMapAccountClientIds] = useState<Set<string> | null>(null);
  /** Selected partner for the "route to next job" affordance + the computed route. */
  const [liveMapRoutedPartnerId, setLiveMapRoutedPartnerId] = useState<string | null>(null);
  const [liveMapRoute, setLiveMapRoute] = useState<DrivingRoute | null>(null);
  const [liveMapRouteJobId, setLiveMapRouteJobId] = useState<string | null>(null);
  const [liveMapRouteLoading, setLiveMapRouteLoading] = useState(false);
  /** O dia inteiro do parceiro roteado (casa → paradas → oportunidades por perto). */
  const [dayRoute, setDayRoute] = useState<DayRouteData | null>(null);
  const [dayRouteOpenNearby, setDayRouteOpenNearby] = useState<DayRouteStop[]>([]);
  /** Bump para re-buscar o dia (ex.: depois de atribuir um job pelo mapa). */
  const [dayRouteNonce, setDayRouteNonce] = useState(0);
  /** Job clicado no mapa para atribuir direto (modo rota). */
  const [mapAssignTarget, setMapAssignTarget] = useState<{ id: string; reference: string } | null>(null);
  /** Status row scoping the partner pins on the map (left panel). */
  const [liveMapPartnerStatus, setLiveMapPartnerStatus] = useState<LiveMapPartnerStatus | null>(null);
  const [liveMapPanNonce, setLiveMapPanNonce] = useState(0);
  const [liveMapLondonNonce, setLiveMapLondonNonce] = useState(0);
  const [mapViewAwayFromLondon, setMapViewAwayFromLondon] = useState(false);
  /** Status row scoping the job pins on the map (right panel). */
  const [liveMapJobStatusFilter, setLiveMapJobStatusFilter] = useState<LiveMapJobStatusCategory | null>(null);
  /** Matches Live View trade filter + job title parsing to Admin → Services catalog names. */
  const [serviceCatalogTypeNames, setServiceCatalogTypeNames] = useState<string[]>([]);
  const [serviceCatalogServices, setServiceCatalogServices] = useState<CatalogService[]>([]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const refreshJobsForBeacon = useCallback(() => {
    void loadJobs();
  }, [loadJobs]);

  useBeaconJobsRealtime(refreshJobsForBeacon, "beacon_schedule_jobs");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = getSupabase();
      const { data } = await supabase
        .from("partners")
        .select(COVERAGE_PARTNER_SELECT)
        .eq("status", "active");
      if (!cancelled) setCoveragePartners((data ?? []) as PartnerCoverageRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void listCatalogServicesForPicker()
      .then((rows) => {
        setServiceCatalogServices(rows);
        setServiceCatalogTypeNames(
          rows.map((r) => (typeof r.name === "string" ? r.name.trim() : "")).filter(Boolean),
        );
      })
      .catch(() => {
        setServiceCatalogServices([]);
        setServiceCatalogTypeNames([]);
      });
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
      const { data: activePartners } = await supabase
        .from("partners")
        .select(LIVE_MAP_PARTNER_SELECT)
        .eq("status", "active");

      const nowMs = Date.now();
      const rows = await Promise.all(
        ((activePartners ?? []) as ActivePartnerMapRow[]).map((p) =>
          resolveActivePartnerMapPoint(p, nowMs, serviceCatalogServices),
        ),
      );

      setLiveMapPoints(rows);
      setLiveMapUpdatedAt(new Date().toISOString());
    } catch {
      /* ignore */
    } finally {
      setLoadingLiveMap(false);
    }
  }, [serviceCatalogServices]);

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

  // Resolve the account filter to a client_id set used downstream when
  // narrowing job pins. `null` = no account filter; empty Set = account has
  // no clients (caller should render zero job pins).
  useEffect(() => {
    let cancelled = false;
    if (beaconFilters.accountId === "all") {
      setLiveMapAccountClientIds(null);
      return;
    }
    void (async () => {
      const ids = await resolveAccountClientIds(beaconFilters.accountId);
      if (cancelled) return;
      setLiveMapAccountClientIds(ids ? new Set(ids) : new Set());
    })();
    return () => {
      cancelled = true;
    };
  }, [beaconFilters.accountId]);

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

  /** Map's date window comes from the top BeaconHeader so it stays in sync
   *  with List / Kanban. "All" → unbounded. */
  const liveSelectedWindow = useMemo<{ fromMs: number; toMs: number }>(() => {
    const range = getDateRangeForMode(beaconFilters);
    if (!range) return { fromMs: -Infinity, toMs: Infinity };
    return {
      fromMs: new Date(range.fromIso).getTime(),
      toMs: new Date(range.toIso).getTime(),
    };
  }, [beaconFilters]);

  const liveMapSelectedLabel = useMemo(() => {
    if (beaconFilters.dateMode === "custom") {
      if (!Number.isFinite(liveSelectedWindow.fromMs) || !Number.isFinite(liveSelectedWindow.toMs)) {
        return "Custom range";
      }
      const from = new Date(liveSelectedWindow.fromMs);
      const to = new Date(liveSelectedWindow.toMs);
      const sameDay = from.toDateString() === to.toDateString();
      if (sameDay) {
        return from.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
      }
      return `${from.toLocaleDateString(undefined, { day: "numeric", month: "short" })}–${to.toLocaleDateString(
        undefined,
        { day: "numeric", month: "short" },
      )}`;
    }
    return DATE_MODE_LABEL[beaconFilters.dateMode] ?? "All time";
  }, [beaconFilters.dateMode, liveSelectedWindow]);

  const jobsForSelectedDay = useMemo<Job[]>(() => {
    const { fromMs, toMs } = liveSelectedWindow;
    return jobs.filter((j) => {
      // Every job in the selected date window gets a pin, completed included:
      // "Today" on the map has to mean the whole day, not just what is still
      // open. Cancelled and deleted stay out — there is nothing on the ground.
      if (j.status === "cancelled" || j.status === "deleted") return false;
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
      const pid = beaconFilters.partnerId;
      if (pid !== "all") {
        if (pid === "__unassigned__") {
          if (j.partner_id || j.partner_name) return false;
        } else if (j.partner_id !== pid) {
          return false;
        }
      }
      return true;
    });
  }, [jobs, liveSelectedWindow, liveMapTradeFilter, beaconFilters.partnerId, serviceCatalogTypeNames]);

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

  useEffect(() => {
    const current = new Set(
      jobs
        .filter((j) => j.status === "unassigned" || j.status === "auto_assigning")
        .map((j) => j.id),
    );
    if (!didInitRecentJobsRef.current) {
      didInitRecentJobsRef.current = true;
      prevUnassignedJobIdsRef.current = current;
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const prev = prevUnassignedJobIdsRef.current;
    for (const id of current) {
      if (prev.has(id)) continue;
      setRecentJobIds((s) => new Set(s).add(id));
      timers.push(
        setTimeout(() => {
          setRecentJobIds((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
          });
        }, 60_000),
      );
    }
    prevUnassignedJobIdsRef.current = current;
    return () => timers.forEach(clearTimeout);
  }, [jobs]);

  const partnerPointsForMap = useMemo<ScheduleLiveMapPoint[]>(() => {
    const nowMs = Date.now();
    return filteredLiveMapPoints.map((p) => {
      const s = partnerStatsById.get(p.id);
      const status = computePartnerStatus({
        partnerId: p.id,
        partnerLat: p.latitude,
        partnerLng: p.longitude,
        inactive: p.inactive,
        jobs: jobs.map((j) => ({
          partner_id: j.partner_id,
          status: j.status,
          latitude: j.latitude,
          longitude: j.longitude,
          scheduled_start_at: j.scheduled_start_at,
        })),
        nowMs,
      });
      return {
        id: p.id,
        name: p.name,
        latitude: p.latitude,
        longitude: p.longitude,
        lastUpdateIso: p.lastUpdateIso,
        trade: p.trade,
        trades: p.trades,
        status,
        jobsCompleted: s?.completed,
        jobsInWindow: s?.inWindow,
        jobStrokeColor:
          status === "offline" ? "#9A9AA0" : partnerJobStrokeColor(p.id, jobs),
      } satisfies ScheduleLiveMapPoint;
    });
  }, [filteredLiveMapPoints, partnerStatsById, jobs]);

  const coverageSearch = useMemo<LiveMapCoverageSearchState | null>(() => {
    if (!coverageDraft) return null;
    const onlineAuthUserIds = new Set(
      partnerPointsForMap.filter((p) => p.status !== "offline").map((p) => p.id),
    );
    const matches = activePartnersCoveringTarget(
      coveragePartners,
      coverageDraft.target,
      liveMapTradeFilter,
      onlineAuthUserIds,
    );
    return { ...coverageDraft, matches };
  }, [coverageDraft, coveragePartners, liveMapTradeFilter, partnerPointsForMap]);

  const coverageHighlightUserIds = useMemo(() => {
    if (!coverageSearch?.matches.length) return null;
    const ids = coverageSearch.matches
      .map((m) => m.partner.auth_user_id?.trim())
      .filter(Boolean) as string[];
    return ids.length > 0 ? new Set(ids) : null;
  }, [coverageSearch]);

  const coverageSearchMarker = useMemo(() => {
    if (!coverageSearch) return null;
    return {
      latitude: coverageSearch.target.latitude,
      longitude: coverageSearch.target.longitude,
      label: coverageSearch.target.label,
    };
  }, [coverageSearch]);

  const coverageCircle = useMemo(() => {
    if (!coverageSearch) return null;
    return {
      latitude: coverageSearch.target.latitude,
      longitude: coverageSearch.target.longitude,
      radiusMiles: coverageSearch.radiusMiles,
    };
  }, [coverageSearch]);

  const handleCoverageSearchChange = useCallback((next: LiveMapCoverageSearchState | null) => {
    if (!next) {
      setCoverageDraft(null);
      return;
    }
    setCoverageDraft({ target: next.target, radiusMiles: next.radiusMiles });
  }, []);

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
    /**
     * A sequência do dia é PERMANENTE (dono, 25/08): unassigned e scheduled
     * ganham a bolinha de ordem sempre, com ou sem parceiro selecionado. Sem
     * parceiro, a numeração é o dia inteiro em ordem de chegada; com parceiro
     * selecionado, o modo rota (routeModeJobPoints) assume e renumera só os
     * jobs dele.
     */
    const sequenciaveis = new Set(["unassigned", "auto_assigning", "scheduled", "late"]);
    const ordenados = jobsForSelectedDay
      .filter((j) => sequenciaveis.has(j.status))
      .sort((a, b) => {
        const am = a.scheduled_start_at ? new Date(a.scheduled_start_at).getTime() : Infinity;
        const bm = b.scheduled_start_at ? new Date(b.scheduled_start_at).getTime() : Infinity;
        return am - bm;
      });
    const ordemPorId = new Map(ordenados.map((j, i) => [j.id, i + 1]));
    for (const pt of points) {
      const ordem = ordemPorId.get(pt.id);
      if (ordem != null) pt.routeOrder = ordem;
    }
    return points;
  }, [jobsForSelectedDay, serviceCatalogTypeNames, liveMapAccountClientIds]);

  /**
   * O DIA INTEIRO do parceiro roteado (dono, 24/08): casa → paradas na ordem
   * agendada → rota real de carro pelo Directions, mais os jobs sem dono por
   * perto para alocar do próprio mapa. Substitui o antigo "próximo job".
   */
  const routeDateYmd = useMemo(() => {
    const { fromMs, toMs } = liveSelectedWindow;
    if (Number.isFinite(fromMs) && Number.isFinite(toMs)) {
      const from = new Date(fromMs);
      const to = new Date(toMs);
      if (from.toDateString() === to.toDateString()) {
        return `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`;
      }
    }
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, [liveSelectedWindow]);

  useEffect(() => {
    if (!liveMapRoutedPartnerId) {
      setLiveMapRoute(null);
      setLiveMapRouteJobId(null);
      setDayRoute(null);
      setDayRouteOpenNearby([]);
      return;
    }
    let cancelled = false;
    setLiveMapRouteLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/partners/${liveMapRoutedPartnerId}/day-route?date=${routeDateYmd}`,
        );
        const json = (await res.json().catch(() => null)) as {
          partner?: { id: string; name: string; home: { latitude: number; longitude: number; label: string } | null };
          date?: string;
          stops?: DayRouteStop[];
          openNearby?: DayRouteStop[];
        } | null;
        if (cancelled) return;
        if (!res.ok || !json?.partner) {
          setDayRoute(null);
          setDayRouteOpenNearby([]);
          setLiveMapRoute(null);
          return;
        }
        const stops = (json.stops ?? []).filter(
          (st) => typeof st.latitude === "number" && typeof st.longitude === "number",
        );
        const waypoints = [
          ...(json.partner.home ? [json.partner.home] : []),
          ...stops.map((st) => ({ latitude: st.latitude as number, longitude: st.longitude as number })),
        ];
        const multi = waypoints.length >= 2 ? await getDrivingRouteMulti(waypoints) : null;
        if (cancelled) return;
        // Sem casa gravada, a primeira perna não existe: alinha os legs com as
        // paradas inserindo um "leg vazio" na frente.
        const legs = multi
          ? json.partner.home
            ? multi.legs
            : [{ durationSec: 0, distanceM: 0 }, ...multi.legs]
          : [];
        setDayRoute({
          partnerId: json.partner.id,
          partnerName: json.partner.name,
          date: json.date ?? routeDateYmd,
          home: json.partner.home,
          stops: json.stops ?? [],
          openNearbyCount: (json.openNearby ?? []).length,
          legs,
          totalSec: multi?.durationSec ?? 0,
          totalM: multi?.distanceM ?? 0,
        });
        setDayRouteOpenNearby(json.openNearby ?? []);
        setLiveMapRoute(
          multi
            ? { geometry: multi.geometry, durationSec: multi.durationSec, distanceM: multi.distanceM }
            : null,
        );
        setLiveMapRouteJobId(null);
      } finally {
        if (!cancelled) setLiveMapRouteLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [liveMapRoutedPartnerId, routeDateYmd, dayRouteNonce]);

  /** Drag no painel de rota: a ordem decidida vira route_seq (mig 282) e passa
   *  a mandar no painel, na numeração do mapa e no email das 17h do parceiro.
   *  Otimista na tela; as pernas de deslocamento recalculam no refetch. */
  const handleDayRouteReorder = useCallback(
    (orderedJobIds: string[]) => {
      setDayRoute((atual) => {
        if (!atual) return atual;
        const porId = new Map(atual.stops.map((s) => [s.id, s]));
        const stops = orderedJobIds.map((id) => porId.get(id)).filter((s): s is DayRouteStop => !!s);
        return stops.length === atual.stops.length ? { ...atual, stops } : atual;
      });
      void fetch("/api/jobs/route-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedJobIds }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const json = (await res.json().catch(() => null)) as { error?: string } | null;
            toast.error(json?.error ?? "Failed to save route order");
          }
        })
        .catch(() => toast.error("Failed to save route order"))
        .finally(() => setDayRouteNonce((n) => n + 1));
    },
    [],
  );

  /** No modo rota o mapa mostra SÓ o dia do parceiro + oportunidades: paradas
   *  numeradas na ordem, e os jobs sem dono por perto em cor de unassigned. */
  const routeModeJobPoints = useMemo<ScheduleLiveMapJobPoint[] | null>(() => {
    if (!dayRoute) return null;
    const pts: ScheduleLiveMapJobPoint[] = [];
    let ordem = 0;
    for (const stop of dayRoute.stops) {
      if (typeof stop.latitude !== "number" || typeof stop.longitude !== "number") continue;
      ordem += 1;
      pts.push({
        id: stop.id,
        latitude: stop.latitude,
        longitude: stop.longitude,
        reference: stop.reference,
        title: stop.title ?? stop.reference,
        partnerName: dayRoute.partnerName,
        clientName: stop.client_name ?? undefined,
        propertyAddress: stop.property_address ?? "",
        statusLabel: statusConfig[stop.status]?.label ?? stop.status,
        statusCategory: liveMapCategoryForStatus(stop.status),
        tradeLabel: resolveScheduleJobTypeKey(stop.title ?? "", serviceCatalogTypeNames),
        scheduleLine: "",
        routeOrder: ordem,
      });
    }
    for (const open of dayRouteOpenNearby) {
      if (typeof open.latitude !== "number" || typeof open.longitude !== "number") continue;
      pts.push({
        id: open.id,
        latitude: open.latitude,
        longitude: open.longitude,
        reference: open.reference,
        title: open.title ?? open.reference,
        partnerName: null,
        clientName: open.client_name ?? undefined,
        propertyAddress: open.property_address ?? "",
        statusLabel: statusConfig[open.status]?.label ?? open.status,
        statusCategory: "unassigned",
        tradeLabel: resolveScheduleJobTypeKey(open.title ?? "", serviceCatalogTypeNames),
        scheduleLine: "",
      });
    }
    return pts;
  }, [dayRoute, dayRouteOpenNearby, serviceCatalogTypeNames]);

  const dayRouteOpenIds = useMemo(
    () => new Set(dayRouteOpenNearby.map((o) => o.id)),
    [dayRouteOpenNearby],
  );

  const handlePartnerMarkerClick = useCallback((partnerId: string) => {
    setLiveMapRoutedPartnerId((cur) => {
      const next = cur === partnerId ? null : partnerId;
      if (next) {
        setLiveMapPanNonce((n) => n + 1);
        setMapViewAwayFromLondon(true);
      }
      return next;
    });
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

  /** Modo rota: clicar num job sem dono abre o Assign partner na hora, com o
   *  parceiro da rota pré-selecionado. Fora do modo rota, clique = seleção. */
  const handleJobMarkerClickRouted = useCallback(
    (id: string) => {
      if (dayRoute && dayRouteOpenIds.has(id)) {
        const alvo = dayRouteOpenNearby.find((o) => o.id === id);
        setMapAssignTarget({ id, reference: alvo?.reference ?? "" });
        return;
      }
      toggleJobSelection(id);
    },
    [dayRoute, dayRouteOpenIds, dayRouteOpenNearby, toggleJobSelection],
  );

  const clearJobSelection = useCallback(() => setLiveMapSelectedJobIds(new Set()), []);

  const liveMapSelectedJobSet = liveMapSelectedJobIds;
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

  // Mirrors Pulse "Live Now": real-time count, full status set
  // (in_progress + late + final_check), no period filter.
  const beaconLiveCount = realTimeLiveCount;

  const togglePartnerStatus = useCallback((status: LiveMapPartnerStatus) => {
    setLiveMapPartnerStatus((cur) => {
      const next = cur === status ? null : status;
      if (next) setMapViewAwayFromLondon(true);
      return next;
    });
  }, []);

  const backToLondon = useCallback(() => {
    setLiveMapLondonNonce((n) => n + 1);
    setMapViewAwayFromLondon(false);
  }, []);

  const toggleJobStatus = useCallback((category: LiveMapJobStatusCategory) => {
    setLiveMapJobStatusFilter((cur) => (cur === category ? null : category));
  }, []);

  const focusPartner = useCallback((partnerId: string) => {
    setLiveMapRoutedPartnerId(partnerId);
    setLiveMapPanNonce((n) => n + 1);
    setMapViewAwayFromLondon(true);
  }, []);

  return (
    <PageTransition
      className={cn(
        "flex flex-col min-w-0 gap-4 -mt-2 sm:-mt-3 lg:-mt-4",
        // Map and Kanban are full-height boards: the page itself never scrolls,
        // each column (or the map) scrolls inside its own box.
        (view === "map" || view === "kanban") &&
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
          points={showPartnersOnMap ? partnerPointsForMap : EMPTY_PARTNER_POINTS}
          regionPreset={liveMapRegionPreset}
          tradeFilter={liveMapTradeFilter}
          embeddedInCard
          jobPoints={routeModeJobPoints ?? (showJobsOnMap ? liveMapJobPoints : EMPTY_JOB_POINTS)}
          selectedJobIds={liveMapSelectedJobSet}
          onJobMarkerClick={handleJobMarkerClickRouted}
          onPartnerMarkerClick={handlePartnerMarkerClick}
          routeGeometry={liveMapRoute?.geometry ?? null}
          toolbarExtra={
            <>
              <button
                type="button"
                className={LIVE_MAP_TOOLBAR_BTN_CLASS}
                onClick={() => void loadLiveMap()}
              >
                <RefreshCw className={cn("h-3 w-3 shrink-0", loadingLiveMap && "animate-spin")} aria-hidden />
                Refresh
              </button>
              {mapViewAwayFromLondon ? (
                <button
                  type="button"
                  className={cn(
                    LIVE_MAP_TOOLBAR_BTN_CLASS,
                    "border-[#020040]/20 bg-[#020040]/5 text-[#020040] hover:bg-[#020040]/10",
                  )}
                  onClick={backToLondon}
                >
                  <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                  Back to London
                </button>
              ) : null}
            </>
          }
          partnerStatusFilter={liveMapPartnerStatus}
          panToPartnerId={liveMapRoutedPartnerId}
          panNonce={liveMapPanNonce}
          resetToLondonNonce={liveMapLondonNonce}
          jobStatusFilter={liveMapJobStatusFilter}
          searchMarker={
            dayRoute?.home
              ? { latitude: dayRoute.home.latitude, longitude: dayRoute.home.longitude, label: "🏠 " + dayRoute.partnerName }
              : coverageSearchMarker
          }
          coverageCircle={coverageCircle}
          coverageHighlightUserIds={coverageHighlightUserIds}
          recentJobIds={recentJobIds}
          filterOverlay={
            <LiveMapCoverageScout
              tradeFilter={liveMapTradeFilter}
              onTradeFilterChange={setLiveMapTradeFilter}
              catalogTradeNames={serviceCatalogTypeNames}
              catalogServices={serviceCatalogServices}
              search={coverageSearch}
              onSearchChange={handleCoverageSearchChange}
              entityType={liveMapEntityType}
              onEntityTypeChange={setLiveMapEntityType}
            />
          }
          bottomLeftOverlay={
            <div className="flex flex-col gap-2">
              {liveMapRoutedPartnerId ? (
                <LiveMapDayRoutePanel
                  route={dayRoute}
                  loading={liveMapRouteLoading}
                  onClose={clearRoute}
                  onBackToLondon={backToLondon}
                  onStopClick={(jobId) => window.open(`/jobs/${jobId}`, "_blank")}
                  onReorder={handleDayRouteReorder}
                />
              ) : null}
              {showPartnersOnMap ? (
              <LiveMapPartnersPanel
                points={partnerPointsForMap}
                selectedStatus={liveMapPartnerStatus}
                onStatusToggle={togglePartnerStatus}
                onPartnerClick={focusPartner}
                lastUpdatedAt={liveMapUpdatedAt}
              />
              ) : null}
            </div>
          }
          bottomRightOverlay={
            showJobsOnMap ? (
            <LiveMapJobsPanel
              jobPoints={liveMapJobPoints}
              selectedStatus={liveMapJobStatusFilter}
              onStatusToggle={toggleJobStatus}
              selectedJobIds={liveMapSelectedJobSet}
              onClearSelection={clearJobSelection}
              jobsMissingLocation={liveMapJobsMissingLocation}
              dateLabel={liveMapSelectedLabel}
            />
            ) : null
          }
        />
      </motion.div>
      )}
      {mapAssignTarget ? (
        <AssignPartnerModal
          jobId={mapAssignTarget.id}
          jobReference={mapAssignTarget.reference}
          isOpen={mapAssignTarget !== null}
          initialPartnerId={dayRoute?.partnerId ?? null}
          onClose={() => setMapAssignTarget(null)}
          onAssigned={() => {
            setMapAssignTarget(null);
            // O job ganhou dono: a rota do dia recalcula e o pin sai da lista
            // de oportunidades sozinho.
            setDayRouteNonce((n) => n + 1);
            void loadLiveMap();
          }}
        />
      ) : null}
    </PageTransition>
  );
}
