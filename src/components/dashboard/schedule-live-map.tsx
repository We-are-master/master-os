"use client";

import { useEffect, useMemo, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin } from "lucide-react";
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

export function ScheduleLiveMap({ points, className }: ScheduleLiveMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

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

  return <div ref={mapContainerRef} className={cn("h-[68vh] min-h-[430px] w-full rounded-xl border border-border", className)} />;
}
