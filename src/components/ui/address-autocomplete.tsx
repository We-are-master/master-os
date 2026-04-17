"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { MapPin, Loader2, X } from "lucide-react";
import { extractUkPostcode } from "@/lib/uk-postcode";
import { cn } from "@/lib/utils";

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
  /** Called when the user types (so parent can sync e.g. property_address for validation) */
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Merged onto the text field (dashboard default styling). */
  fieldClassName?: string;
  country?: string;
  label?: string;
  /** Dashboard (default) vs dark partner portal / public pages */
  variant?: "default" | "dark";
  /** Multi-line field (e.g. full address block); still uses Mapbox forward geocoding while typing */
  multiline?: boolean;
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

  const ctxPostcode = find("postcode");
  const postcode = ctxPostcode || extractUkPostcode(feature.place_name) || "";

  return {
    full_address: feature.place_name,
    address: street,
    city: find("place") || find("locality") || find("district"),
    postcode,
    country: find("country"),
    lng: feature.center[0],
    lat: feature.center[1],
  };
}

export function AddressAutocomplete({
  value = "",
  onSelect,
  onChange,
  placeholder = "Start typing an address or postcode...",
  className = "",
  fieldClassName,
  country = "gb",
  label,
  variant = "default",
  multiline = false,
}: AddressAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<GeoFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isDark = variant === "dark";

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
    const el = multiline ? textareaRef.current : inputRef.current;
    if (open && results.length > 0 && el) {
      const rect = el.getBoundingClientRect();
      setDropdownRect({ top: rect.bottom, left: rect.left, width: rect.width });
    } else {
      setDropdownRect(null);
    }
  }, [open, results.length, multiline]);

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
    onChange?.(val);
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
    onChange?.("");
  };

  const iconClass = isDark ? "text-zinc-500" : "text-text-tertiary";
  const controlIconPin = cn(
    "absolute left-3 h-4 w-4 pointer-events-none",
    multiline ? "top-3" : "top-1/2 -translate-y-1/2",
    iconClass,
  );
  const controlActions = cn(
    "absolute right-3 flex items-center gap-1",
    multiline ? "top-3" : "top-1/2 -translate-y-1/2",
  );
  const fieldClass = cn(
    "w-full rounded-xl border pl-9 pr-9 text-sm transition-all",
    multiline ? "min-h-[5.5rem] py-2.5 resize-y leading-relaxed" : "h-10",
    isDark
      ? "border-zinc-700 bg-zinc-950 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#e93701]/35"
      : "border-border bg-card text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary",
    fieldClassName,
  );

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && (
        <label
          className={cn(
            "block font-medium mb-1.5",
            isDark ? "text-sm text-zinc-300" : "text-xs text-text-secondary",
          )}
        >
          {label}
        </label>
      )}
      <div className="relative">
        <MapPin className={controlIconPin} />
        {multiline ? (
          <textarea
            ref={textareaRef}
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => {
              if (results.length > 0) setOpen(true);
            }}
            placeholder={placeholder}
            rows={3}
            className={fieldClass}
          />
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => {
              if (results.length > 0) setOpen(true);
            }}
            placeholder={placeholder}
            className={fieldClass}
          />
        )}
        <div className={controlActions}>
          {loading && (
            <Loader2
              className={cn("h-3.5 w-3.5 animate-spin", isDark ? "text-zinc-500" : "text-text-tertiary")}
            />
          )}
          {query && !loading && (
            <button
              type="button"
              onClick={handleClear}
              className={isDark ? "text-zinc-500 hover:text-zinc-300 transition-colors" : "text-text-tertiary hover:text-text-secondary transition-colors"}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {!MAPBOX_TOKEN && (
        <p className={cn("text-[10px] mt-1.5", isDark ? "text-zinc-500" : "text-text-tertiary")}>
          Enter the full address manually (Mapbox suggestions unavailable — set NEXT_PUBLIC_MAPBOX_TOKEN for autocomplete).
        </p>
      )}
      {open && results.length > 0 && dropdownRect && typeof document !== "undefined" &&
        createPortal(
          <div
            data-address-dropdown
            className={cn(
              "fixed z-[9999] mt-1 rounded-xl shadow-lg overflow-hidden max-h-60 overflow-y-auto",
              isDark
                ? "bg-[#121212] border border-zinc-700"
                : "bg-card border border-border",
            )}
            style={{ top: dropdownRect.top + 4, left: dropdownRect.left, width: dropdownRect.width }}
          >
            {results.map((feature, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSelect(feature)}
                className={cn(
                  "w-full flex items-start gap-2.5 px-3 py-2.5 transition-colors text-left",
                  isDark ? "hover:bg-zinc-800/90" : "hover:bg-surface-hover",
                )}
              >
                <MapPin className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", isDark ? "text-[#e93701]" : "text-primary")} />
                <div className="min-w-0">
                  <p className={cn("text-sm truncate", isDark ? "text-zinc-100" : "text-text-primary")}>
                    {feature.text}
                    {feature.address ? `, ${feature.address}` : ""}
                  </p>
                  <p className={cn("text-[11px] truncate", isDark ? "text-zinc-500" : "text-text-tertiary")}>
                    {feature.place_name}
                  </p>
                </div>
              </button>
            ))}
            <div
              className={cn(
                "px-3 py-1.5 border-t sticky bottom-0",
                isDark ? "border-zinc-800 bg-zinc-900/80" : "border-border-light bg-surface-hover/60",
              )}
            >
              <p className={cn("text-[9px] text-center", isDark ? "text-zinc-600" : "text-text-tertiary")}>
                Powered by Mapbox
              </p>
            </div>
          </div>,
          document.body
        )
      }
    </div>
  );
}
