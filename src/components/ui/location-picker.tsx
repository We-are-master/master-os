"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin, Search, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

interface LocationResult {
  address: string;
  lng: number;
  lat: number;
}

interface LocationPickerProps {
  value?: string;
  onChange: (result: LocationResult) => void;
  placeholder?: string;
  className?: string;
  /** Height for the map container. Default: 220px */
  mapHeight?: string;
  /** Show as read-only mini map (no search) */
  readOnly?: boolean;
  /** Initial center [lng, lat] */
  center?: [number, number];
}

export function LocationPicker({
  value = "",
  onChange,
  placeholder = "Search for an address...",
  className = "",
  mapHeight = "220px",
  readOnly = false,
  center,
}: LocationPickerProps) {
  const fillHeight = readOnly && mapHeight === "100%";
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<Array<{ place_name: string; center: [number, number] }>>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!mapContainer.current || !MAPBOX_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const defaultCenter = center ?? [-73.9857, 40.7484]; // NYC default

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: defaultCenter,
      zoom: center ? 14 : 11,
      interactive: !readOnly,
    });

    if (!readOnly) {
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    }

    if (center) {
      markerRef.current = new mapboxgl.Marker({ color: "#ef4444" })
        .setLngLat(center)
        .addTo(map);
    }

    if (!readOnly) {
      map.on("click", (e) => {
        const { lng, lat } = e.lngLat;
        placeMarker(map, [lng, lat]);
        reverseGeocode(lng, lat);
      });
    }

    mapRef.current = map;

    const resize = () => {
      try {
        map.resize();
      } catch {
        /* ignore */
      }
    };
    map.on("load", resize);
    const ro =
      mapContainer.current &&
      new ResizeObserver(() => {
        requestAnimationFrame(resize);
      });
    if (mapContainer.current && ro) ro.observe(mapContainer.current);

    return () => {
      map.off("load", resize);
      ro?.disconnect();
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  const placeMarker = (map: mapboxgl.Map, lngLat: [number, number]) => {
    if (markerRef.current) markerRef.current.remove();
    markerRef.current = new mapboxgl.Marker({ color: "#ef4444" })
      .setLngLat(lngLat)
      .addTo(map);
    map.flyTo({ center: lngLat, zoom: 15, duration: 800 });
  };

  const reverseGeocode = async (lng: number, lat: number) => {
    if (!MAPBOX_TOKEN) return;
    try {
      const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1`);
      const data = await res.json();
      const place = data.features?.[0];
      if (place) {
        const addr = place.place_name;
        setQuery(addr);
        onChange({ address: addr, lng, lat });
      }
    } catch { /* silent */ }
  };

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim() || !MAPBOX_TOKEN) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&limit=5&types=address,place,neighborhood,locality`
      );
      const data = await res.json();
      setResults(data.features?.map((f: { place_name: string; center: [number, number] }) => ({
        place_name: f.place_name,
        center: f.center,
      })) ?? []);
      setShowResults(true);
    } catch { setResults([]); }
    finally { setSearching(false); }
  }, []);

  const handleInputChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => handleSearch(val), 350);
  };

  const handleSelectResult = (result: { place_name: string; center: [number, number] }) => {
    setQuery(result.place_name);
    setShowResults(false);
    setResults([]);
    if (mapRef.current) {
      placeMarker(mapRef.current, result.center);
    }
    onChange({ address: result.place_name, lng: result.center[0], lat: result.center[1] });
  };

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setShowResults(false);
    if (markerRef.current) markerRef.current.remove();
    onChange({ address: "", lng: 0, lat: 0 });
  };

  if (!MAPBOX_TOKEN) {
    return (
      <div className={`rounded-xl border border-border bg-surface-hover p-4 text-center ${className}`}>
        <MapPin className="h-6 w-6 text-text-tertiary mx-auto mb-2" />
        <p className="text-xs text-text-tertiary">Mapbox token not configured</p>
        <p className="text-[10px] text-text-tertiary mt-0.5">Add NEXT_PUBLIC_MAPBOX_TOKEN to .env.local</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        fillHeight ? "h-full min-h-0 flex flex-col" : "space-y-2",
        className,
      )}
    >
      {/* Search input */}
      {!readOnly && (
        <div className="relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
            <input
              type="text"
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              onFocus={() => { if (results.length) setShowResults(true); }}
              placeholder={placeholder}
              className="w-full h-10 bg-card border border-border rounded-xl px-4 pl-10 pr-10 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30 hover:border-border transition-all"
            />
            {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary animate-spin" />}
            {!searching && query && (
              <button type="button" onClick={handleClear} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary transition-colors">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Results dropdown */}
          {showResults && results.length > 0 && (
            <div className="absolute z-50 mt-1 w-full bg-card rounded-xl border border-border shadow-lg overflow-hidden">
              {results.map((r, i) => (
                <button
                  type="button"
                  key={i}
                  onClick={() => handleSelectResult(r)}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-surface-hover transition-colors flex items-start gap-2.5 border-b border-border-light last:border-0"
                >
                  <MapPin className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                  <span className="text-text-primary line-clamp-2">{r.place_name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Map */}
      <div
        ref={mapContainer}
        className={cn(
          "rounded-xl border border-border overflow-hidden w-full min-h-0",
          fillHeight && "flex-1 min-h-[100px] h-0",
        )}
        style={fillHeight ? undefined : { height: mapHeight }}
      />

      {/* Selected address display */}
      {query && !readOnly && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100">
          <MapPin className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          <p className="text-xs text-emerald-700 truncate">{query}</p>
        </div>
      )}
    </div>
  );
}

/** Mini map centered on lat/lng (e.g. live partner location) */
export function LocationMiniMapByCoords({
  latitude,
  longitude,
  className,
  label,
}: {
  latitude: number;
  longitude: number;
  className?: string;
  label?: string;
}) {
  const center: [number, number] = [Number(longitude), Number(latitude)];
  if (!MAPBOX_TOKEN) {
    return (
      <div className={`rounded-xl bg-surface-hover p-4 text-center text-sm text-text-tertiary ${className ?? ""}`}>
        Set NEXT_PUBLIC_MAPBOX_TOKEN to show map. Location: {latitude.toFixed(5)}, {longitude.toFixed(5)}
      </div>
    );
  }
  return (
    <div className={className}>
      <LocationPicker readOnly center={center} value="" onChange={() => {}} mapHeight="200px" />
      {label && (
        <div className="flex items-center gap-2 mt-1.5">
          <MapPin className="h-3 w-3 text-primary shrink-0" />
          <p className="text-xs text-text-tertiary">{label}</p>
        </div>
      )}
    </div>
  );
}

function LocationMiniMapInner({
  address,
  mapHeight = "160px",
  showAddressBelowMap = true,
}: {
  address: string;
  mapHeight?: string;
  showAddressBelowMap?: boolean;
}) {
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [loading, setLoading] = useState(true);
  const fillParent = mapHeight === "100%";

  useEffect(() => {
    if (!address || !MAPBOX_TOKEN) {
      setLoading(false);
      return;
    }
    fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${MAPBOX_TOKEN}&limit=1`)
      .then((r) => r.json())
      .then((data) => {
        const feat = data.features?.[0];
        if (feat) setCoords(feat.center as [number, number]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [address]);

  if (loading) {
    return (
      <div
        className={`animate-pulse bg-surface-tertiary rounded-xl w-full ${fillParent ? "h-full min-h-[140px]" : "h-32"}`}
      />
    );
  }

  if (!coords || !MAPBOX_TOKEN) return null;

  return (
    <div className={fillParent ? "flex flex-col h-full min-h-0 w-full" : "w-full"}>
      <div
        className={cn(
          "w-full min-w-0 overflow-hidden",
          fillParent ? "flex-1 min-h-[120px] h-0 rounded-xl border border-border" : "",
        )}
      >
        <LocationPicker
          readOnly
          center={coords}
          value={address}
          onChange={() => {}}
          mapHeight={fillParent ? "100%" : mapHeight}
          className={fillParent ? "h-full" : ""}
        />
      </div>
      {showAddressBelowMap ? (
        <div className="flex items-center gap-2 mt-1.5 min-w-0">
          <MapPin className="h-3 w-3 text-red-400 shrink-0" />
          <p className="text-xs text-text-tertiary truncate">{address}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Small static map for read-only location display. Set `lazy` to defer geocoding + Mapbox until near the viewport. */
export function LocationMiniMap({
  address,
  className,
  lazy = false,
  mapHeight = "160px",
  showAddressBelowMap = true,
}: {
  address: string;
  className?: string;
  /** When true, Mapbox JS and geocoding run only after the block scrolls into view (faster first paint). */
  lazy?: boolean;
  /** Map container height; use `"100%"` with a parent that has defined height (e.g. aspect-ratio box). */
  mapHeight?: string;
  /** When false, hides the caption under the map (parent already shows the address). */
  showAddressBelowMap?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!lazy);
  const fillParent = mapHeight === "100%";

  useEffect(() => {
    if (!lazy) return;
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setVisible(true);
      },
      { rootMargin: "200px", threshold: 0.01 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [lazy]);

  return (
    <div
      ref={wrapRef}
      className={`${className ?? ""}${fillParent ? " h-full min-h-0 flex flex-col" : ""}`}
    >
      {lazy && !visible ? (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-surface-hover p-3 min-h-[4.5rem]">
          <MapPin className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-text-primary line-clamp-3">{address || "No address"}</p>
            <p className="text-[10px] text-text-tertiary mt-1">Map loads when you scroll here</p>
          </div>
        </div>
      ) : (
        <LocationMiniMapInner
          address={address}
          mapHeight={mapHeight}
          showAddressBelowMap={showAddressBelowMap}
        />
      )}
    </div>
  );
}
