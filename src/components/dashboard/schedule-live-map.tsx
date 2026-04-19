"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, type ReactNode } from "react";
import type { RefObject } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildLiveMapPopupHtml, createLiveMapMarkerElement } from "@/components/dashboard/live-map-marker-icons";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

export type LiveMapRegionPreset = "london" | "uk" | "europe" | "fit_all";

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

function pointIdsSignature(points: ScheduleLiveMapPoint[]): string {
  return [...new Set(points.map((p) => p.id))].sort().join(",");
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
}: ScheduleLiveMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const prevRegionRef = useRef<LiveMapRegionPreset | null>(null);

  const validPoints = useMemo(
    () =>
      points.filter(
        (p) =>
          Number.isFinite(Number(p.latitude)) &&
          Number.isFinite(Number(p.longitude)) &&
          Math.abs(Number(p.latitude)) <= 90 &&
          Math.abs(Number(p.longitude)) <= 180,
      ),
    [points],
  );

  const idsSig = useMemo(() => pointIdsSignature(validPoints), [validPoints]);

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
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /** Markers + popups — refresh when locations or trade icon mode changes. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (validPoints.length === 0) return;

    for (const point of validPoints) {
      const el = createLiveMapMarkerElement({
        inactive: point.inactive,
        tradeFilter: tradeFilter === "all" ? "all" : tradeFilter,
        trade: point.trade,
        trades: point.trades ?? null,
      });
      const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
        .setLngLat([point.longitude, point.latitude])
        .setPopup(
          new mapboxgl.Popup({ closeButton: false, offset: 12 }).setHTML(
            buildLiveMapPopupHtml({
              name: point.name,
              inactive: point.inactive,
              lastUpdateIso: point.lastUpdateIso,
              trade: point.trade,
              trades: point.trades ?? null,
            }),
          ),
        )
        .addTo(map);
      markersRef.current.push(marker);
    }
  }, [validPoints, tradeFilter]);

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

    if (validPoints.length === 0) {
      prevRegionRef.current = regionPreset;
      return;
    }

    const bounds = new mapboxgl.LngLatBounds();
    for (const point of validPoints) {
      bounds.extend([point.longitude, point.latitude]);
    }

    const switchedToFitAll = prevRegionRef.current !== "fit_all";
    prevRegionRef.current = regionPreset;

    if (validPoints.length === 1) {
      const p = validPoints[0]!;
      map.flyTo({
        center: [p.longitude, p.latitude],
        zoom: 12,
        duration: switchedToFitAll ? 600 : 0,
        essential: true,
      });
      return;
    }

    map.fitBounds(bounds, {
      padding: 64,
      maxZoom: 13,
      minZoom: 3,
      duration: switchedToFitAll ? 700 : 0,
    });
  }, [regionPreset, idsSig]);

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
