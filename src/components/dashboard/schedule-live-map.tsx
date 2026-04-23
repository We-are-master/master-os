"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, type ReactNode } from "react";
import type { RefObject } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { normalizeLiveMapCoordinate } from "@/lib/live-map-coordinate";
import {
  buildLiveMapJobPopupHtml,
  buildLiveMapPopupHtml,
  liveMapTradeIconKey,
  liveMapTradeIconKeys,
  renderLiveMapTradeIconSvg,
  type LiveMapJobStatusCategory,
} from "@/components/dashboard/live-map-marker-icons";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

export type LiveMapRegionPreset = "london" | "uk" | "europe" | "fit_all";

const PARTNER_SOURCE_ID = "live-map-partners";
const PARTNER_CIRCLE_LAYER_ID = "live-map-partners-circle";
const PARTNER_INITIALS_LAYER_ID = "live-map-partners-initials";
const PARTNER_BADGE_LAYER_ID = "live-map-partners-badge";
const PARTNER_BADGE_ICON_LAYER_ID = "live-map-partners-badge-icon";

const JOB_SOURCE_ID = "live-map-jobs";
const JOB_CIRCLE_LAYER_ID = "live-map-jobs-circle";
const JOB_ICON_LAYER_ID = "live-map-jobs-icon";

const PARTNER_BADGE_ACTIVE_ICON_PREFIX = "fixfy-partner-badge-active-";
const PARTNER_BADGE_INACTIVE_ICON_PREFIX = "fixfy-partner-badge-inactive-";
const JOB_ICON_PREFIX = "fixfy-job-center-";

const PARTNER_BADGE_ACTIVE_COLOR = "#0F6E56";
const PARTNER_BADGE_INACTIVE_COLOR = "#9A9AA0";
const PARTNER_BADGE_ICON_SIZE = 14;
const PARTNER_BADGE_RADIUS = 8;
const PARTNER_BADGE_OFFSET: [number, number] = [12, -11];

function toInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

async function ensureMapImage(map: mapboxgl.Map, imageId: string, svg: string): Promise<void> {
  if (map.hasImage(imageId)) return;
  const svgWithNs = svg.includes('xmlns="http://www.w3.org/2000/svg"')
    ? svg
    : svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgWithNs)}`;
  await new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (!map.hasImage(imageId)) {
        try {
          map.addImage(imageId, img);
        } catch {
          // noop: keep map resilient if browser rejects this image payload
        }
      }
      resolve();
    };
    img.onerror = () => {
      // Fallback path: rasterize the SVG into ImageData and register that.
      const canvas = document.createElement("canvas");
      canvas.width = 24;
      canvas.height = 24;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve();
        return;
      }
      const fallbackImg = new Image();
      fallbackImg.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(fallbackImg, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        if (!map.hasImage(imageId)) {
          try {
            map.addImage(imageId, imageData);
          } catch {
            // noop
          }
        }
        resolve();
      };
      fallbackImg.onerror = () => resolve();
      fallbackImg.src = url;
    };
    try {
      img.src = url;
    } catch {
      if (!map.hasImage(imageId)) {
        resolve();
      }
    }
  });
}

export interface ScheduleLiveMapPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  lastUpdateIso: string;
  inactive: boolean;
  /** Primary trade label from partners (or inferred). */
  trade?: string;
  trades?: string[] | null;
  /** Optional stats for the hover preview — caller computes from jobs. */
  jobsCompleted?: number;
  jobsInWindow?: number;
}

/**
 * Jobs-of-the-day overlay point. Rendered alongside partner pins in the
 * same Mapbox map without affecting the existing partner marker logic.
 */
export interface ScheduleLiveMapJobPoint {
  id: string;
  latitude: number;
  longitude: number;
  /** Summary fields used for the popup — keeps this component pure. */
  reference: string;
  title: string;
  partnerName: string | null;
  clientName?: string;
  propertyAddress: string;
  statusLabel: string;
  /** Status bucket that drives the pin color (unassigned/scheduled/in_progress/attention). */
  statusCategory: LiveMapJobStatusCategory;
  tradeLabel: string;
  scheduleLine: string;
}

interface ScheduleLiveMapProps {
  points: ScheduleLiveMapPoint[];
  className?: string;
  /** Map framing: London default does not jump on every data refresh. */
  regionPreset?: LiveMapRegionPreset;
  /** When a specific trade is selected, markers use that trade icon (caller filters points). */
  tradeFilter?: "all" | string;
  /** Extra controls next to Full screen (e.g. Refresh), top-left overlay on the map. */
  toolbarExtra?: ReactNode;
  /** When true, map sits flush under a filter bar (no top radius / top border). */
  embeddedInCard?: boolean;
  /** Optional job overlay — renders extra markers for jobs of a selected day. */
  jobPoints?: ScheduleLiveMapJobPoint[];
  /** Currently selected jobs (for manual dispatch). Selected = thicker ring. */
  selectedJobIds?: ReadonlySet<string>;
  /** Fired when a job pin is clicked. Caller decides: toggle selection, open drawer, etc. */
  onJobMarkerClick?: (jobId: string) => void;
  /** Filter controls panel — floated below the top-left toolbar on the map. */
  filterOverlay?: ReactNode;
  /** Live stats + legend panel — floated at the bottom-left corner of the map. */
  bottomLeftOverlay?: ReactNode;
  /** Dispatch / jobs-of-the-day panel — floated at the bottom-right corner of the map. */
  bottomRightOverlay?: ReactNode;
}

const LONDON_CENTER: [number, number] = [-0.1276, 51.5072];
const UK_BOUNDS: mapboxgl.LngLatBoundsLike = [
  [-8.65, 49.5],
  [2.35, 58.85],
];
const EUROPE_BOUNDS: mapboxgl.LngLatBoundsLike = [
  [-11.5, 35.5],
  [40.5, 71.2],
];

function pointGeometrySignature(points: Array<{ id: string; latitude: number; longitude: number }>): string {
  return points
    .map((p) => `${p.id}:${Number(p.latitude).toFixed(5)},${Number(p.longitude).toFixed(5)}`)
    .sort()
    .join("|");
}

function useMapResize(mapRef: RefObject<mapboxgl.Map | null>, fullscreen: boolean) {
  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const run = () => {
      map.resize();
    };
    run();
    const t = window.setTimeout(run, 150);
    return () => window.clearTimeout(t);
  }, [mapRef, fullscreen]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onWinResize = () => {
      map.resize();
    };
    window.addEventListener("resize", onWinResize);
    return () => window.removeEventListener("resize", onWinResize);
  }, [mapRef]);
}

/** Shared with Schedule page for Refresh + map overlay buttons. */
export const LIVE_MAP_TOOLBAR_BTN_CLASS =
  "inline-flex items-center gap-1 rounded-md border-[0.5px] border-[#D8D8DD] bg-white px-[9px] py-[5px] text-[11px] font-medium text-[#020040] shadow-sm transition-colors hover:bg-[#FAFAFB]";

export function ScheduleLiveMap({
  points,
  className,
  regionPreset = "london",
  tradeFilter = "all",
  toolbarExtra,
  embeddedInCard = false,
  jobPoints,
  selectedJobIds,
  onJobMarkerClick,
  filterOverlay,
  bottomLeftOverlay,
  bottomRightOverlay,
}: ScheduleLiveMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const partnerPopupRef = useRef<mapboxgl.Popup | null>(null);
  const jobPopupRef = useRef<mapboxgl.Popup | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const prevRegionRef = useRef<LiveMapRegionPreset | null>(null);

  const validPoints = useMemo(
    () => {
      const next: ScheduleLiveMapPoint[] = [];
      for (const point of points) {
        const normalized = normalizeLiveMapCoordinate(point.latitude, point.longitude);
        if (!normalized) continue;
        next.push({
          ...point,
          latitude: normalized.latitude,
          longitude: normalized.longitude,
        });
      }
      return next;
    },
    [points],
  );

  const validJobPoints = useMemo(
    () => {
      const next: ScheduleLiveMapJobPoint[] = [];
      for (const job of jobPoints ?? []) {
        const normalized = normalizeLiveMapCoordinate(job.latitude, job.longitude);
        if (!normalized) continue;
        next.push({
          ...job,
          latitude: normalized.latitude,
          longitude: normalized.longitude,
        });
      }
      return next;
    },
    [jobPoints],
  );

  const pointSig = useMemo(() => pointGeometrySignature(validPoints), [validPoints]);
  const jobPointSig = useMemo(() => pointGeometrySignature(validJobPoints), [validJobPoints]);
  const partnerById = useMemo(
    () => new Map(validPoints.map((p) => [p.id, p])),
    [validPoints],
  );
  const jobById = useMemo(
    () => new Map(validJobPoints.map((j) => [j.id, j])),
    [validJobPoints],
  );

  useMapResize(mapRef, fullscreen);

  const exitFullscreen = useCallback(() => setFullscreen(false), []);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, exitFullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  useEffect(() => {
    if (!mapContainerRef.current || !MAPBOX_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: LONDON_CENTER,
      zoom: 9,
      projection: "globe",
      minZoom: 2.2,
      pitch: 0,
      bearing: 0,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    map.on("load", () => setMapReady(true));
    mapRef.current = map;
    partnerPopupRef.current = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 14,
    });
    jobPopupRef.current = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: { bottom: [0, -58] as [number, number] },
    });

    return () => {
      partnerPopupRef.current?.remove();
      jobPopupRef.current?.remove();
      partnerPopupRef.current = null;
      jobPopupRef.current = null;
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /** Mapbox-native marker rendering via GeoJSON + layers (stable on globe zoom/pan). */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!mapReady) return;

    let cancelled = false;
    const registerTradeIcons = async () => {
      const keys = liveMapTradeIconKeys();
      for (const key of keys) {
        if (cancelled) return;
        await ensureMapImage(
          map,
          `${PARTNER_BADGE_ACTIVE_ICON_PREFIX}${key}`,
          renderLiveMapTradeIconSvg(key, { size: PARTNER_BADGE_ICON_SIZE, color: PARTNER_BADGE_ACTIVE_COLOR }),
        );
        await ensureMapImage(
          map,
          `${PARTNER_BADGE_INACTIVE_ICON_PREFIX}${key}`,
          renderLiveMapTradeIconSvg(key, { size: PARTNER_BADGE_ICON_SIZE, color: PARTNER_BADGE_INACTIVE_COLOR }),
        );
        await ensureMapImage(
          map,
          `${JOB_ICON_PREFIX}${key}`,
          renderLiveMapTradeIconSvg(key, { size: 20, color: "#FFFFFF" }),
        );
      }
    };

    void registerTradeIcons();
    return () => {
      cancelled = true;
    };
  }, [mapReady]);

  /** Mapbox-native marker rendering via GeoJSON + layers (stable on globe zoom/pan). */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!mapReady) return;

    const partnerFeatures = validPoints.map((p) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [p.longitude, p.latitude] as [number, number],
      },
      properties: {
        id: p.id,
        name: p.name,
        initials: toInitials(p.name),
        inactive: p.inactive ? 1 : 0,
        badgeIconId: `${p.inactive ? PARTNER_BADGE_INACTIVE_ICON_PREFIX : PARTNER_BADGE_ACTIVE_ICON_PREFIX}${liveMapTradeIconKey(
          tradeFilter === "all" ? p.trade : tradeFilter,
        )}`,
      },
    }));
    const partnerCollection = {
      type: "FeatureCollection" as const,
      features: partnerFeatures,
    };

    const jobFeatures = validJobPoints.map((j) => {
      const selected = selectedJobIds?.has(j.id) ? 1 : 0;
      const statusColor =
        j.statusCategory === "unassigned"
          ? "#A32D2D"
          : j.statusCategory === "scheduled"
            ? "#0F6E56"
            : j.statusCategory === "in_progress"
              ? "#378ADD"
              : "#ED4B00";
      return {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [j.longitude, j.latitude] as [number, number],
        },
        properties: {
          id: j.id,
          statusColor,
          jobIconId: `${JOB_ICON_PREFIX}${liveMapTradeIconKey(j.tradeLabel)}`,
          selected,
        },
      };
    });
    const jobCollection = {
      type: "FeatureCollection" as const,
      features: jobFeatures,
    };

    const existingPartnerSource = map.getSource(PARTNER_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (existingPartnerSource) {
      existingPartnerSource.setData(partnerCollection);
    } else {
      map.addSource(PARTNER_SOURCE_ID, {
        type: "geojson",
        data: partnerCollection,
      });
    }

    const existingJobSource = map.getSource(JOB_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (existingJobSource) {
      existingJobSource.setData(jobCollection);
    } else {
      map.addSource(JOB_SOURCE_ID, {
        type: "geojson",
        data: jobCollection,
      });
    }

    if (!map.getLayer(PARTNER_CIRCLE_LAYER_ID)) {
      map.addLayer({
        id: PARTNER_CIRCLE_LAYER_ID,
        type: "circle",
        source: PARTNER_SOURCE_ID,
        paint: {
          "circle-color": "#020040",
          "circle-radius": 20,
          "circle-opacity": ["case", ["==", ["get", "inactive"], 1], 0.55, 1],
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "white",
        },
      });
    }
    if (!map.getLayer(PARTNER_INITIALS_LAYER_ID)) {
      map.addLayer({
        id: PARTNER_INITIALS_LAYER_ID,
        type: "symbol",
        source: PARTNER_SOURCE_ID,
        layout: {
          "text-field": ["get", "initials"],
          "text-size": 13,
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-offset": [0, 0.15],
          "text-allow-overlap": true,
          "text-anchor": "center",
          "text-pitch-alignment": "map",
          "text-rotation-alignment": "map",
        },
        paint: {
          "text-color": "#FFFFFF",
        },
      });
    }
    if (!map.getLayer(PARTNER_BADGE_LAYER_ID)) {
      map.addLayer({
        id: PARTNER_BADGE_LAYER_ID,
        type: "circle",
        source: PARTNER_SOURCE_ID,
        paint: {
          "circle-color": "#FFFFFF",
          "circle-radius": PARTNER_BADGE_RADIUS,
          "circle-stroke-width": 2,
          "circle-stroke-color": ["case", ["==", ["get", "inactive"], 1], "#9A9AA0", "#0F6E56"],
          "circle-translate": PARTNER_BADGE_OFFSET,
          "circle-translate-anchor": "viewport",
        },
      });
    }
    if (!map.getLayer(PARTNER_BADGE_ICON_LAYER_ID)) {
      map.addLayer({
        id: PARTNER_BADGE_ICON_LAYER_ID,
        type: "symbol",
        source: PARTNER_SOURCE_ID,
        layout: {
          "icon-image": ["get", "badgeIconId"],
          "icon-size": 1,
          "icon-allow-overlap": true,
          "icon-anchor": "center",
          "icon-pitch-alignment": "map",
          "icon-rotation-alignment": "map",
        },
        paint: {
          "icon-translate": PARTNER_BADGE_OFFSET,
          "icon-translate-anchor": "viewport",
        },
      });
    }

    if (!map.getLayer(JOB_CIRCLE_LAYER_ID)) {
      map.addLayer({
        id: JOB_CIRCLE_LAYER_ID,
        type: "circle",
        source: JOB_SOURCE_ID,
        paint: {
          "circle-color": ["coalesce", ["get", "statusColor"], "#ED4B00"],
          "circle-radius": 20,
          "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 3, 2.5],
          "circle-stroke-color": ["case", ["==", ["get", "selected"], 1], "#020040", "#FFFFFF"],
        },
      });
    }
    if (!map.getLayer(JOB_ICON_LAYER_ID)) {
      map.addLayer({
        id: JOB_ICON_LAYER_ID,
        type: "symbol",
        source: JOB_SOURCE_ID,
        layout: {
          "icon-image": ["get", "jobIconId"],
          "icon-size": 1,
          "icon-allow-overlap": true,
          "icon-anchor": "center",
          "icon-pitch-alignment": "map",
          "icon-rotation-alignment": "map",
        },
      });
    }
  }, [mapReady, validPoints, validJobPoints, selectedJobIds, tradeFilter]);

  /** Layer events: hover popups + job click selection. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!mapReady) return;
    if (!map.getLayer(PARTNER_CIRCLE_LAYER_ID) || !map.getLayer(JOB_CIRCLE_LAYER_ID)) return;

    const handlePartnerEnter = (e: any) => {
      const feature = e.features?.[0];
      const id = feature?.properties?.id as string | undefined;
      if (!id) return;
      const point = partnerById.get(id);
      if (!point) return;
      const coords = (feature?.geometry as GeoJSON.Point | undefined)?.coordinates ?? [point.longitude, point.latitude];
      map.getCanvas().style.cursor = "pointer";
      partnerPopupRef.current
        ?.setLngLat([Number(coords[0]), Number(coords[1])])
        .setHTML(
          buildLiveMapPopupHtml({
            name: point.name,
            inactive: point.inactive,
            lastUpdateIso: point.lastUpdateIso,
            trade: point.trade,
            trades: point.trades ?? null,
            jobsCompleted: point.jobsCompleted,
            jobsInWindow: point.jobsInWindow,
          }),
        )
        .addTo(map);
    };

    const handlePartnerLeave = () => {
      map.getCanvas().style.cursor = "";
      partnerPopupRef.current?.remove();
    };

    const handleJobEnter = (e: any) => {
      const feature = e.features?.[0];
      const id = feature?.properties?.id as string | undefined;
      if (!id) return;
      const job = jobById.get(id);
      if (!job) return;
      const coords = (feature?.geometry as GeoJSON.Point | undefined)?.coordinates ?? [job.longitude, job.latitude];
      map.getCanvas().style.cursor = "pointer";
      jobPopupRef.current
        ?.setLngLat([Number(coords[0]), Number(coords[1])])
        .setHTML(
          buildLiveMapJobPopupHtml({
            reference: job.reference,
            title: job.title,
            partnerName: job.partnerName,
            clientName: job.clientName,
            propertyAddress: job.propertyAddress,
            statusLabel: job.statusLabel,
            statusCategory: job.statusCategory,
            tradeLabel: job.tradeLabel,
            scheduleLine: job.scheduleLine,
            selected: selectedJobIds?.has(job.id) ?? false,
          }),
        )
        .addTo(map);
    };

    const handleJobLeave = () => {
      map.getCanvas().style.cursor = "";
      jobPopupRef.current?.remove();
    };

    const handleJobClick = (e: any) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (!id || !onJobMarkerClick) return;
      onJobMarkerClick(id);
    };

    map.on("mouseenter", PARTNER_CIRCLE_LAYER_ID, handlePartnerEnter);
    map.on("mouseleave", PARTNER_CIRCLE_LAYER_ID, handlePartnerLeave);
    map.on("mouseenter", JOB_CIRCLE_LAYER_ID, handleJobEnter);
    map.on("mouseleave", JOB_CIRCLE_LAYER_ID, handleJobLeave);
    map.on("click", JOB_CIRCLE_LAYER_ID, handleJobClick);

    return () => {
      map.off("mouseenter", PARTNER_CIRCLE_LAYER_ID, handlePartnerEnter);
      map.off("mouseleave", PARTNER_CIRCLE_LAYER_ID, handlePartnerLeave);
      map.off("mouseenter", JOB_CIRCLE_LAYER_ID, handleJobEnter);
      map.off("mouseleave", JOB_CIRCLE_LAYER_ID, handleJobLeave);
      map.off("click", JOB_CIRCLE_LAYER_ID, handleJobClick);
    };
  }, [mapReady, partnerById, jobById, onJobMarkerClick, selectedJobIds]);

  /** Fixed regions: only when the user changes the preset (not when filters change). */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (regionPreset === "fit_all") return;

    if (regionPreset === "london") {
      map.flyTo({ center: LONDON_CENTER, zoom: 10.5, duration: 600, essential: true });
    } else if (regionPreset === "uk") {
      map.fitBounds(UK_BOUNDS, { padding: 56, maxZoom: 8, duration: 650 });
    } else if (regionPreset === "europe") {
      map.fitBounds(EUROPE_BOUNDS, { padding: 48, maxZoom: 5.5, duration: 650 });
    }
    prevRegionRef.current = regionPreset;
  }, [regionPreset]);

  /** Fit all markers: when preset is fit_all and the visible partner set changes — not on every location poll. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (regionPreset !== "fit_all") return;

    const fitPoints = [
      ...validPoints.map((p) => ({ longitude: p.longitude, latitude: p.latitude })),
      ...validJobPoints.map((j) => ({ longitude: j.longitude, latitude: j.latitude })),
    ];

    if (fitPoints.length === 0) {
      prevRegionRef.current = regionPreset;
      return;
    }

    const bounds = new mapboxgl.LngLatBounds();
    for (const point of fitPoints) {
      bounds.extend([point.longitude, point.latitude]);
    }

    const switchedToFitAll = prevRegionRef.current !== "fit_all";
    prevRegionRef.current = regionPreset;

    if (fitPoints.length === 1) {
      const p = fitPoints[0]!;
      map.flyTo({
        center: [p.longitude, p.latitude],
        zoom: 12,
        duration: switchedToFitAll ? 600 : 0,
        essential: true,
      });
      return;
    }

    map.fitBounds(bounds, {
      padding: 72,
      maxZoom: 12.5,
      minZoom: 2.2,
      duration: switchedToFitAll ? 700 : 0,
    });
  }, [regionPreset, pointSig, jobPointSig, validPoints, validJobPoints]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className={cn("rounded-xl border border-border bg-surface-hover p-6 text-center", className)}>
        <MapPin className="mx-auto mb-2 h-6 w-6 text-text-tertiary" />
        <p className="text-sm text-text-secondary">Mapbox token not configured</p>
        <p className="mt-1 text-xs text-text-tertiary">Set `NEXT_PUBLIC_MAPBOX_TOKEN` in environment.</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        fullscreen ? "fixed inset-0 z-[240] flex flex-col bg-card" : "relative",
        !fullscreen && className,
      )}
      role={fullscreen ? "dialog" : undefined}
      aria-modal={fullscreen ? "true" : undefined}
      aria-label={fullscreen ? "Live team map fullscreen" : undefined}
    >
      {fullscreen ? (
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
          <span className="truncate text-sm font-semibold text-text-primary">Live team map</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<Minimize2 className="h-3.5 w-3.5" />}
            onClick={exitFullscreen}
          >
            Exit full screen
          </Button>
        </div>
      ) : null}

      <div className="relative flex w-full min-h-0 flex-1 flex-col">
        {!fullscreen ? (
          <div className="absolute left-3 top-3 z-[2] flex flex-wrap items-center gap-2">
            {toolbarExtra}
            <button
              type="button"
              className={LIVE_MAP_TOOLBAR_BTN_CLASS}
              onClick={() => setFullscreen(true)}
            >
              <Maximize2 className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
              Full screen
            </button>
          </div>
        ) : null}
        {!fullscreen && filterOverlay ? (
          <div className="absolute left-3 right-3 top-14 z-[2] sm:right-auto sm:max-w-[calc(100%-3rem)]">
            {filterOverlay}
          </div>
        ) : null}
        {!fullscreen && (bottomLeftOverlay || bottomRightOverlay) ? (
          <>
            <div className="absolute inset-x-3 bottom-3 z-[2] space-y-2 sm:hidden">
              {bottomLeftOverlay ? <div className="w-full">{bottomLeftOverlay}</div> : null}
              {bottomRightOverlay ? <div className="w-full">{bottomRightOverlay}</div> : null}
            </div>
            {bottomLeftOverlay ? (
              <div className="absolute bottom-7 left-3 z-[2] hidden sm:block sm:max-w-[calc(55%-0.75rem)]">
                {bottomLeftOverlay}
              </div>
            ) : null}
            {bottomRightOverlay ? (
              <div className="absolute bottom-7 right-3 z-[2] hidden sm:block sm:max-w-[calc(65%-0.75rem)]">
                {bottomRightOverlay}
              </div>
            ) : null}
          </>
        ) : null}
        <div
          ref={mapContainerRef}
          className={cn(
            "w-full",
            fullscreen
              ? "min-h-0 flex-1 rounded-none border-0"
              : embeddedInCard
                ? "h-full min-h-[200px] w-full rounded-none border-0"
                : "h-full min-h-[200px] rounded-xl border border-border",
          )}
        />
      </div>
    </div>
  );
}
