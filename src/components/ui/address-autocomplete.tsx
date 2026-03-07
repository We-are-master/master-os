"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { MapPin, Loader2, X } from "lucide-react";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

export interface AddressParts {
  full_address: string;
  address: string;
  city: string;
  postcode: string;
  country: string;
  lng?: number;
  lat?: number;
}

interface AddressAutocompleteProps {
  value?: string;
  onSelect: (parts: AddressParts) => void;
  placeholder?: string;
  className?: string;
  country?: string;
  label?: string;
}

interface GeoFeature {
  place_name: string;
  center: [number, number];
  context?: Array<{ id: string; text: string; short_code?: string }>;
  text: string;
  address?: string;
  properties?: { address?: string };
}

function extractParts(feature: GeoFeature): AddressParts {
  const ctx = feature.context ?? [];
  const find = (prefix: string) => ctx.find((c) => c.id.startsWith(prefix))?.text ?? "";

  const streetNumber = feature.address ?? feature.properties?.address ?? "";
  const streetName = feature.text ?? "";
  const street = streetNumber ? `${streetNumber} ${streetName}` : streetName;

  return {
    full_address: feature.place_name,
    address: street,
    city: find("place") || find("locality") || find("district"),
    postcode: find("postcode"),
    country: find("country"),
    lng: feature.center[0],
    lat: feature.center[1],
  };
}

export function AddressAutocomplete({
  value = "",
  onSelect,
  placeholder = "Start typing an address or postcode...",
  className = "",
  country = "gb",
  label,
}: AddressAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<GeoFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node & { closest?: (s: string) => Element | null };
      if (containerRef.current?.contains(target)) return;
      if (target.closest?.("[data-address-dropdown]")) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && results.length > 0 && inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownRect({ top: rect.bottom, left: rect.left, width: rect.width });
    } else {
      setDropdownRect(null);
    }
  }, [open, results.length]);

  const search = useCallback(async (q: string) => {
    if (!MAPBOX_TOKEN || q.length < 3) { setResults([]); return; }
    setLoading(true);
    try {
      const types = "address,postcode,place,locality";
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&types=${types}&country=${country}&limit=5&language=en`;
      const res = await fetch(url);
      const data = await res.json();
      setResults(data.features ?? []);
      setOpen((data.features ?? []).length > 0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [country]);

  const handleChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 300);
  };

  const handleSelect = (feature: GeoFeature) => {
    const parts = extractParts(feature);
    setQuery(parts.full_address);
    setOpen(false);
    setResults([]);
    onSelect(parts);
  };

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && (
        <label className="block text-xs font-medium text-text-secondary mb-1.5">{label}</label>
      )}
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          placeholder={placeholder}
          className="w-full h-10 rounded-xl border border-border bg-card pl-9 pr-9 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-text-tertiary" />}
          {query && !loading && (
            <button onClick={handleClear} className="text-text-tertiary hover:text-text-secondary transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {open && results.length > 0 && dropdownRect && typeof document !== "undefined" &&
        createPortal(
          <div
            data-address-dropdown
            className="fixed z-[9999] mt-1 bg-card rounded-xl border border-border shadow-lg overflow-hidden max-h-60 overflow-y-auto"
            style={{ top: dropdownRect.top + 4, left: dropdownRect.left, width: dropdownRect.width }}
          >
            {results.map((feature, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSelect(feature)}
                className="w-full flex items-start gap-2.5 px-3 py-2.5 hover:bg-surface-hover transition-colors text-left"
              >
                <MapPin className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm text-text-primary truncate">{feature.text}{feature.address ? `, ${feature.address}` : ""}</p>
                  <p className="text-[11px] text-text-tertiary truncate">{feature.place_name}</p>
                </div>
              </button>
            ))}
            <div className="px-3 py-1.5 border-t border-border-light bg-surface-hover/60 sticky bottom-0">
              <p className="text-[9px] text-text-tertiary text-center">Powered by Mapbox</p>
            </div>
          </div>,
          document.body
        )
      }
    </div>
  );
}
