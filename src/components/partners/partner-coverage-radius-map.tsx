"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MAPBOX_UK_CENTER_LON_LAT, MAPBOX_UK_MAX_BOUNDS } from "@/lib/mapbox-uk-geography";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

type Props = {
  latitude: number;
  longitude: number;
  radiusMiles: number;
  className?: string;
  mapHeight?: string;
};

/** Read-only map: base pin + radius circle in miles. */
export function PartnerCoverageRadiusMap({
  latitude,
  longitude,
  radiusMiles,
  className = "",
  mapHeight = "220px",
}: Props) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!mapContainer.current || !MAPBOX_TOKEN) return;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || radiusMiles <= 0) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const center: [number, number] = [longitude, latitude];
    const radiusMeters = radiusMiles * 1609.344;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center,
      zoom: 10,
      interactive: true,
      maxBounds: MAPBOX_UK_MAX_BOUNDS,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    const sourceId = "coverage-radius";
    const layerId = "coverage-radius-fill";
    const outlineId = "coverage-radius-outline";

    map.on("load", () => {
      const geo = {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: center,
        },
        properties: {},
      };
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, { type: "geojson", data: geo });
      }
      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: "circle",
          source: sourceId,
          paint: {
            "circle-radius": {
              stops: [
                [0, 0],
                [20, radiusMeters],
              ],
              base: 2,
            },
            "circle-color": "#ED4B00",
            "circle-opacity": 0.15,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ED4B00",
          },
        });
      }
      new mapboxgl.Marker({ color: "#ED4B00" }).setLngLat(center).addTo(map);
      const bounds = new mapboxgl.LngLatBounds();
      const steps = 32;
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * 2 * Math.PI;
        const dx = (radiusMeters / 111320) * Math.cos(angle);
        const dy = (radiusMeters / 110540) * Math.sin(angle);
        bounds.extend([center[0] + dx / Math.cos((latitude * Math.PI) / 180), center[1] + dy]);
      }
      map.fitBounds(bounds, { padding: 40, maxZoom: 12, duration: 0 });
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [latitude, longitude, radiusMiles]);

  if (!MAPBOX_TOKEN) {
    return (
      <p className="text-xs text-text-tertiary py-4 text-center">
        Map unavailable (missing Mapbox token).
      </p>
    );
  }

  return (
    <div
      ref={mapContainer}
      className={className}
      style={{ height: mapHeight, width: "100%" }}
      aria-label="Coverage radius map"
    />
  );
}
