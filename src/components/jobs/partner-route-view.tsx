"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Car, ChevronDown, ChevronUp, Copy, ExternalLink, Home, MapPin, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { getDrivingRouteMulti, getOptimizedStopOrder, type Coord } from "@/lib/mapbox-directions";
import { formatArrivalTimeRange, jobScheduleYmd } from "@/lib/schedule-calendar";
import { formatCurrency } from "@/lib/utils";
import type { Job } from "@/types/database";

/**
 * "Route" view for Jobs Management: only meaningful when the partner filter is
 * on, it lays the partner's day out as a route (home → numbered stops), the
 * same order the 5pm "your jobs tomorrow" email uses — geography decides,
 * arrival windows veto (a stop never lands after another whose window already
 * closed). One Matrix call orders, one Directions call prices the legs; both
 * skip gracefully when coords are missing and the list falls back to window
 * order.
 */

type PartnerHome = {
  label: string;
  latitude: number | null;
  longitude: number | null;
};

type RouteLeg = { durationSec: number; distanceM: number };

export function PartnerRouteView({
  jobs,
  partnerId,
  partnerName,
  onOpenJob,
}: {
  jobs: Job[];
  partnerId: string;
  partnerName: string;
  onOpenJob?: (job: Job) => void;
}) {
  const [home, setHome] = useState<PartnerHome | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("partners")
        .select("partner_address, partner_address_latitude, partner_address_longitude")
        .eq("id", partnerId)
        .maybeSingle();
      if (cancelled) return;
      const p = data as {
        partner_address?: string | null;
        partner_address_latitude?: number | null;
        partner_address_longitude?: number | null;
      } | null;
      const lat = Number(p?.partner_address_latitude);
      const lng = Number(p?.partner_address_longitude);
      const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
      const label = p?.partner_address?.trim() || "";
      setHome(hasCoords || label ? { label: label || "Partner base", latitude: hasCoords ? lat : null, longitude: hasCoords ? lng : null } : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [partnerId]);

  const days = useMemo(() => {
    const byDay = new Map<string, Job[]>();
    for (const j of jobs) {
      const ymd = jobScheduleYmd(j);
      const day = ymd
        ? `${ymd.y}-${String(ymd.m).padStart(2, "0")}-${String(ymd.d).padStart(2, "0")}`
        : "unscheduled";
      const list = byDay.get(day) ?? [];
      list.push(j);
      byDay.set(day, list);
    }
    return [...byDay.entries()].sort(([a], [b]) => (a === "unscheduled" ? 1 : b === "unscheduled" ? -1 : a.localeCompare(b)));
  }, [jobs]);

  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border border-border-light bg-card p-8 text-center text-sm text-text-tertiary">
        No jobs for {partnerName} in this view. Adjust the tab or date filter.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {days.map(([day, dayJobs]) => (
        <RouteDay key={day} day={day} jobs={dayJobs} home={home} partnerName={partnerName} onOpenJob={onOpenJob} />
      ))}
    </div>
  );
}

function RouteDay({
  day,
  jobs,
  home,
  partnerName,
  onOpenJob,
}: {
  day: string;
  jobs: Job[];
  home: PartnerHome | null;
  partnerName: string;
  onOpenJob?: (job: Job) => void;
}) {
  const [autoOrder, setAutoOrder] = useState<Job[]>(() => sortByWindow(jobs));
  // Up/down arrows write here (job ids in visit order); null = follow the optimizer.
  const [manualIds, setManualIds] = useState<string[] | null>(null);
  const [legs, setLegs] = useState<RouteLeg[] | null>(null);

  const homeCoord: Coord | null = useMemo(
    () =>
      home && home.latitude != null && home.longitude != null
        ? { latitude: home.latitude, longitude: home.longitude }
        : null,
    [home],
  );

  // Same sanity rule as the optimizer: a base 50km+ away from the day's stops
  // is dirty geocode (e.g. "Hope Farm" landing across the country) — leave it
  // out of the timeline, the legs and the Maps origin instead of showing a
  // fantasy 2h first drive.
  const usableHome = useMemo(() => {
    if (!home) return null;
    if (!homeCoord) return home.label && home.label !== "Partner base" ? home : null;
    const located = jobs.filter((j) => hasCoords(j));
    if (located.length === 0) return home;
    const cLat = located.reduce((a, j) => a + Number(j.latitude), 0) / located.length;
    const cLng = located.reduce((a, j) => a + Number(j.longitude), 0) / located.length;
    const km =
      Math.hypot(homeCoord.latitude - cLat, (homeCoord.longitude - cLng) * Math.cos((cLat * Math.PI) / 180)) * 111;
    return Number.isFinite(km) && km <= 50 ? home : null;
  }, [home, homeCoord, jobs]);

  const usableHomeCoord: Coord | null =
    usableHome && usableHome.latitude != null && usableHome.longitude != null
      ? { latitude: usableHome.latitude, longitude: usableHome.longitude }
      : null;

  useEffect(() => {
    let cancelled = false;
    const base = sortByWindow(jobs);
    setAutoOrder(base);
    setManualIds(null);

    (async () => {
      const allLocated = base.every((j) => hasCoords(j));

      // Geography orders, windows veto — same rule as the partner email.
      if (allLocated && base.length >= 2 && base.length <= 8) {
        const order = await getOptimizedStopOrder(
          base.map((j) => ({ latitude: j.latitude!, longitude: j.longitude! })),
          { start: homeCoord },
        );
        if (order && !cancelled) {
          const optimized = order.map((i) => base[i]!);
          const violatesWindow = optimized.some((j, i) => {
            if (i === 0) return false;
            const prev = optimized[i - 1]!;
            return (
              j.scheduled_end_at != null &&
              prev.scheduled_start_at != null &&
              new Date(j.scheduled_end_at).getTime() < new Date(prev.scheduled_start_at).getTime()
            );
          });
          if (!violatesWindow) setAutoOrder(optimized);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // homeCoord is derived from `home`; jobs identity changes with the filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, home?.latitude, home?.longitude]);

  const ordered = useMemo(() => {
    if (!manualIds) return autoOrder;
    const byId = new Map(autoOrder.map((j) => [j.id, j]));
    const manual = manualIds.map((id) => byId.get(id)).filter((j): j is Job => j != null);
    return manual.length === autoOrder.length ? manual : autoOrder;
  }, [autoOrder, manualIds]);

  // Legs follow whatever order is on screen — optimizer's or the hand-made one.
  const orderedKey = ordered.map((j) => j.id).join(",");
  useEffect(() => {
    let cancelled = false;
    setLegs(null);
    if (ordered.length === 0 || !ordered.every((j) => hasCoords(j))) return;
    const points: Coord[] = [
      ...(usableHomeCoord ? [usableHomeCoord] : []),
      ...ordered.map((j) => ({ latitude: j.latitude!, longitude: j.longitude! })),
    ];
    if (points.length < 2) return;
    (async () => {
      const multi = await getDrivingRouteMulti(points);
      if (!cancelled && multi) setLegs(multi.legs);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedKey, home?.latitude, home?.longitude]);

  const moveStop = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    const ids = ordered.map((j) => j.id);
    const tmp = ids[index]!;
    ids[index] = ids[target]!;
    ids[target] = tmp;
    setManualIds(ids);
  };

  const totals = useMemo(() => {
    const amountIn = ordered.reduce((s, j) => s + Number(j.client_price ?? 0) + Number(j.extras_amount ?? 0), 0);
    const costOut = ordered.reduce((s, j) => s + Number(j.partner_cost ?? 0), 0);
    const driveSec = (legs ?? []).reduce((s, l) => s + l.durationSec, 0);
    const driveM = (legs ?? []).reduce((s, l) => s + l.distanceM, 0);
    return { amountIn, costOut, driveSec, driveM };
  }, [ordered, legs]);

  const mapsUrl = useMemo(() => buildGoogleMapsUrl(usableHome, ordered), [usableHome, ordered]);

  // With a home the leg before stop i is legs[i]; without, legs[i - 1].
  const legBeforeStop = (i: number): RouteLeg | null => {
    if (!legs) return null;
    const idx = usableHomeCoord ? i : i - 1;
    return idx >= 0 ? legs[idx] ?? null : null;
  };

  const copyRouteLink = async () => {
    if (!mapsUrl) return;
    try {
      await navigator.clipboard.writeText(mapsUrl);
      toast.success("Route link copied");
    } catch {
      window.prompt("Copy route link", mapsUrl);
    }
  };

  return (
    <div className="rounded-xl border border-border-light bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-light pb-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-text-primary">{dayLabel(day)}</p>
          <p className="text-[11px] text-text-tertiary">
            {partnerName} · {ordered.length} {ordered.length === 1 ? "stop" : "stops"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {manualIds ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="h-3 w-3" />}
              title="Back to the suggested order (geography + arrival windows)"
              onClick={() => setManualIds(null)}
            >
              Suggested order
            </Button>
          ) : null}
          {mapsUrl ? (
            <>
              <Button
                size="sm"
                variant="outline"
                icon={<ExternalLink className="h-3 w-3" />}
                title="Open the full route in Google Maps"
                onClick={() => window.open(mapsUrl, "_blank", "noopener,noreferrer")}
              >
                Open in Google Maps
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={<Copy className="h-3 w-3" />}
                title="Copy the Google Maps route link (paste it on WhatsApp)"
                onClick={() => void copyRouteLink()}
              >
                Copy route link
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="pt-3">
        {usableHome ? (
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-text-secondary">
              <Home className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-text-primary">Start · partner base</p>
              <p className="truncate text-[11px] text-text-tertiary">{usableHome.label}</p>
            </div>
          </div>
        ) : null}

        {ordered.map((j, i) => {
          const leg = legBeforeStop(i);
          const showLegRail = i > 0 || usableHome != null;
          const amount = Number(j.client_price ?? 0) + Number(j.extras_amount ?? 0);
          return (
            <div key={j.id}>
              {showLegRail ? (
                <div className="ml-[13px] border-l-2 border-dashed border-border py-1 pl-[25px] text-[11px] text-text-tertiary">
                  {leg ? (
                    <span className="inline-flex items-center gap-1">
                      <Car className="h-3 w-3" aria-hidden /> {formatDuration(leg.durationSec)} · {formatMiles(leg.distanceM)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 opacity-60">
                      <Car className="h-3 w-3" aria-hidden /> drive
                    </span>
                  )}
                </div>
              ) : null}
              <div className="flex items-start gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-surface-hover">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {i + 1}
                </span>
                <button type="button" onClick={() => onOpenJob?.(j)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-semibold text-text-primary">
                    {j.client_name || j.title || j.reference}
                    <span className="font-normal text-text-tertiary"> · {j.reference}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-text-secondary">
                    <MapPin className="h-3 w-3 shrink-0 text-text-tertiary" aria-hidden />
                    <span className="truncate">{j.property_address || "No address"}</span>
                  </span>
                </button>
                <span className="shrink-0 text-right">
                  <span className="block text-xs font-semibold tabular-nums text-text-primary">{windowLabel(j)}</span>
                  <span className="block text-[11px] tabular-nums text-text-tertiary">
                    {formatCurrency(amount)} · cost {formatCurrency(Number(j.partner_cost ?? 0))}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col gap-0.5">
                  <button
                    type="button"
                    aria-label={`Move stop ${i + 1} up`}
                    title="Move up"
                    disabled={i === 0}
                    onClick={() => moveStop(i, -1)}
                    className="flex h-5 w-6 items-center justify-center rounded border border-border-light text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move stop ${i + 1} down`}
                    title="Move down"
                    disabled={i === ordered.length - 1}
                    onClick={() => moveStop(i, 1)}
                    className="flex h-5 w-6 items-center justify-center rounded border border-border-light text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border-light pt-3">
        <p className="text-[11px] text-text-secondary">
          {ordered.length} {ordered.length === 1 ? "stop" : "stops"}
          {totals.driveSec > 0 ? ` · ${formatDuration(totals.driveSec)} driving · ${formatMiles(totals.driveM)}` : ""}
          {" · "}
          {formatCurrency(totals.amountIn)} in · {formatCurrency(totals.costOut)} out
        </p>
      </div>
    </div>
  );
}

function hasCoords(j: Job): j is Job & { latitude: number; longitude: number } {
  return Number.isFinite(Number(j.latitude)) && Number.isFinite(Number(j.longitude));
}

function sortByWindow(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => {
    const sa = a.scheduled_start_at ? new Date(a.scheduled_start_at).getTime() : Infinity;
    const sb = b.scheduled_start_at ? new Date(b.scheduled_start_at).getTime() : Infinity;
    if (sa !== sb) return sa - sb;
    return (a.reference ?? "").localeCompare(b.reference ?? "");
  });
}

function windowLabel(j: Job): string {
  if (j.scheduled_start_at && j.scheduled_end_at) {
    const range = formatArrivalTimeRange(j.scheduled_start_at, j.scheduled_end_at);
    if (range) return range;
  }
  if (j.scheduled_start_at) {
    const d = new Date(j.scheduled_start_at);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", timeZone: "Europe/London" });
    }
  }
  return "No time";
}

function dayLabel(day: string): string {
  if (day === "unscheduled") return "No date set";
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "Europe/London" });
}

function formatDuration(sec: number): string {
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h}h ${String(min % 60).padStart(2, "0")}m`;
}

function formatMiles(m: number): string {
  return `${(m / 1609.34).toFixed(1)} mi`;
}

/**
 * Universal cross-platform Google Maps directions link: opens the app on the
 * phone with the whole route loaded. Coords when we have them (exact door),
 * address text otherwise.
 */
function buildGoogleMapsUrl(home: PartnerHome | null, stops: Job[]): string | null {
  const point = (j: Job): string | null =>
    hasCoords(j)
      ? `${Number(j.latitude).toFixed(6)},${Number(j.longitude).toFixed(6)}`
      : j.property_address?.trim() || null;

  const stopPoints = stops.map(point).filter((p): p is string => p != null);
  if (stopPoints.length === 0) return null;

  const origin =
    home && home.latitude != null && home.longitude != null
      ? `${home.latitude.toFixed(6)},${home.longitude.toFixed(6)}`
      : home?.label && home.label !== "Partner base"
        ? home.label
        : null;

  const destination = stopPoints[stopPoints.length - 1]!;
  const waypoints = stopPoints.slice(0, -1);

  const params = new URLSearchParams({ api: "1", travelmode: "driving", destination });
  if (origin) params.set("origin", origin);
  if (waypoints.length > 0) params.set("waypoints", waypoints.join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
