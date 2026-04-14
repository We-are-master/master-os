"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import type { RefObject } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

export interface ScheduleLiveMapPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  lastUpdateIso: string;
  inactive: boolean;
}

interface ScheduleLiveMapProps {
  points: ScheduleLiveMapPoint[];
  className?: string;
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

export function ScheduleLiveMap({ points, className }: ScheduleLiveMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [fullscreen, setFullscreen] = useState(false);

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
      center: [-0.1276, 51.5072],
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (validPoints.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    for (const point of validPoints) {
      const color = point.inactive ? "#f59e0b" : "#22c55e";
      const marker = new mapboxgl.Marker({ color })
        .setLngLat([point.longitude, point.latitude])
        .setPopup(
          new mapboxgl.Popup({ closeButton: false, offset: 12 }).setHTML(
            `<div style="font-size:12px"><strong>${point.name}</strong><br/>${point.inactive ? "Inactive" : "Active"}<br/>${new Date(point.lastUpdateIso).toLocaleString()}</div>`,
          ),
        )
        .addTo(map);
      markersRef.current.push(marker);
      bounds.extend([point.longitude, point.latitude]);
    }

    if (validPoints.length === 1) {
      const p = validPoints[0];
      map.flyTo({ center: [p.longitude, p.latitude], zoom: 12, essential: true });
      return;
    }

    map.fitBounds(bounds, { padding: 64, maxZoom: 13, duration: 700 });
  }, [validPoints]);

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

      <div className={cn("relative w-full", fullscreen ? "flex min-h-0 flex-1 flex-col" : "min-h-[430px]")}>
        {!fullscreen ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="absolute left-3 top-3 z-10 border-border/80 bg-card/95 shadow-md backdrop-blur-sm"
            icon={<Maximize2 className="h-3.5 w-3.5" />}
            onClick={() => setFullscreen(true)}
          >
            Full screen
          </Button>
        ) : null}
        <div
          ref={mapContainerRef}
          className={cn(
            "w-full",
            fullscreen
              ? "min-h-0 flex-1 rounded-none border-0"
              : "h-[68vh] min-h-[430px] rounded-xl border border-border",
          )}
        />
      </div>
    </div>
  );
}
