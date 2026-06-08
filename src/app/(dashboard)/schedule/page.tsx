"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  liveMapJobStatusColor,
  type LiveMapJobStatusCategory,
} from "@/components/dashboard/live-map-marker-icons";
import {
  LiveMapCoverageScout,
  type LiveMapCoverageSearchState,
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
          searchMarker={coverageSearchMarker}
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
            />
          }
          bottomLeftOverlay={
            <div className="flex flex-col gap-2">
              {liveMapRoutedPartnerId ? (() => {
                const partner = partnerPointsForMap.find((p) => p.id === liveMapRoutedPartnerId);
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
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={backToLondon}
                          className="text-[10px] font-medium text-[#020040] hover:underline"
                        >
                          London
                        </button>
                        <button
                          type="button"
                          onClick={clearRoute}
                          className="text-[10px] font-medium text-[#64748B] hover:text-[#020040]"
                        >
                          Clear ✕
                        </button>
                      </div>
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
              <LiveMapPartnersPanel
                points={partnerPointsForMap}
                selectedStatus={liveMapPartnerStatus}
                onStatusToggle={togglePartnerStatus}
                onPartnerClick={focusPartner}
                lastUpdatedAt={liveMapUpdatedAt}
              />
            </div>
          }
          bottomRightOverlay={
            <LiveMapJobsPanel
              jobPoints={liveMapJobPoints}
              selectedStatus={liveMapJobStatusFilter}
              onStatusToggle={toggleJobStatus}
              selectedJobIds={liveMapSelectedJobSet}
              onClearSelection={clearJobSelection}
              jobsMissingLocation={liveMapJobsMissingLocation}
              dateLabel={liveMapSelectedLabel}
            />
          }
        />
      </motion.div>
      )}
    </PageTransition>
  );
}
