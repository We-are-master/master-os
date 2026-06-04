"use client";

import { useEffect, useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LocationPicker } from "@/components/ui/location-picker";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  COVERAGE_CITIES,
  COVERAGE_CITY_LONDON_ID,
  coverageCityById,
  defaultLondonIncludedPostcodes,
  normalizeOutwardCode,
} from "@/lib/coverage-cities";
import {
  DEFAULT_COVERAGE_MODE,
  SERVICE_RADIUS_MILE_OPTIONS,
  clearedCoverageFieldsForMode,
  effectiveCoverageMode,
  effectiveIncludedPostcodes,
  formatPartnerCoverageSummary,
} from "@/lib/partner-coverage";
import { extractUkPostcode } from "@/lib/uk-postcode";
import { updatePartner } from "@/services/partners";
import type { Partner, PartnerCoverageMode } from "@/types/database";
import { PartnerCoverageRadiusMap } from "@/components/partners/partner-coverage-radius-map";

type Props = {
  partner: Partner;
  onPartnerUpdate: (p: Partner) => void;
  canEdit?: boolean;
};

const COVERAGE_MODE_OPTIONS = [
  {
    id: "postcodes" as const,
    label: "Postcode districts",
    hint: "Pick London outward codes (e.g. SW11, E1).",
  },
  {
    id: "radius" as const,
    label: "Radius (miles)",
    hint: "Base pin on the map + max distance in miles.",
  },
] as const;

function CoverageModePicker({
  mode,
  onChange,
  disabled,
}: {
  mode: PartnerCoverageMode;
  onChange: (m: PartnerCoverageMode) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-2 border-0 p-0 m-0">
      <legend className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
        Coverage method (choose one)
      </legend>
      <p className="text-[11px] text-text-tertiary -mt-1">
        Postcodes and radius are mutually exclusive — only the selected method is saved and used for job matching.
      </p>
      <div
        className="grid grid-cols-1 sm:grid-cols-2 gap-2"
        role="radiogroup"
        aria-label="Coverage method"
      >
        {COVERAGE_MODE_OPTIONS.map((opt) => {
          const selected = mode === opt.id;
          return (
            <label
              key={opt.id}
              className={cn(
                "flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors",
                selected
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                  : "border-border-light bg-card hover:border-border",
                disabled && "opacity-50 cursor-not-allowed pointer-events-none",
              )}
            >
              <input
                type="radio"
                name="partner-coverage-mode"
                value={opt.id}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(opt.id)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-text-primary">{opt.label}</span>
                <span className="block text-[11px] text-text-tertiary mt-0.5">{opt.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function applyCoverageModeSwitch(
  next: PartnerCoverageMode,
  current: PartnerCoverageMode,
  setters: {
    setMode: (m: PartnerCoverageMode) => void;
    setSelectedOutward: (s: Set<string>) => void;
    setSearch: (s: string) => void;
    setBaseAddress: (s: string) => void;
    setBaseLat: (l: number | null) => void;
    setBaseLng: (l: number | null) => void;
  },
) {
  if (next === current) return;
  setters.setMode(next);
  if (next === "radius") {
    setters.setSelectedOutward(new Set());
    setters.setSearch("");
  } else {
    setters.setBaseAddress("");
    setters.setBaseLat(null);
    setters.setBaseLng(null);
  }
}

export function PartnerCoverageTab({ partner, onPartnerUpdate, canEdit = true }: Props) {
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<PartnerCoverageMode>(
    () => effectiveCoverageMode(partner) ?? DEFAULT_COVERAGE_MODE,
  );
  const [radiusMiles, setRadiusMiles] = useState(
    () => Number(partner.service_radius_miles) || 15,
  );
  const [baseAddress, setBaseAddress] = useState(() => partner.coverage_base_postcode ?? "");
  const [baseLat, setBaseLat] = useState<number | null>(partner.coverage_latitude ?? null);
  const [baseLng, setBaseLng] = useState<number | null>(partner.coverage_longitude ?? null);
  const [cityId, setCityId] = useState(() => partner.coverage_cities?.[0] ?? COVERAGE_CITY_LONDON_ID);
  const [selectedOutward, setSelectedOutward] = useState<Set<string>>(() => {
    const inc = effectiveIncludedPostcodes(partner);
    return new Set(inc.length ? inc : []);
  });
  const [search, setSearch] = useState("");

  useEffect(() => {
    const m = effectiveCoverageMode(partner) ?? DEFAULT_COVERAGE_MODE;
    setMode(m);
    setRadiusMiles(Number(partner.service_radius_miles) || 15);
    setCityId(partner.coverage_cities?.[0] ?? COVERAGE_CITY_LONDON_ID);
    setSearch("");
    if (m === "radius") {
      setBaseAddress(partner.coverage_base_postcode ?? "");
      setBaseLat(partner.coverage_latitude ?? null);
      setBaseLng(partner.coverage_longitude ?? null);
      setSelectedOutward(new Set());
    } else {
      setBaseAddress("");
      setBaseLat(null);
      setBaseLng(null);
      const inc = effectiveIncludedPostcodes(partner);
      setSelectedOutward(new Set(inc.length ? inc : defaultLondonIncludedPostcodes()));
    }
  }, [partner.id]);

  function handleModeChange(next: PartnerCoverageMode) {
    applyCoverageModeSwitch(next, mode, {
      setMode,
      setSelectedOutward,
      setSearch,
      setBaseAddress,
      setBaseLat,
      setBaseLng,
    });
    if (next === "postcodes" && selectedOutward.size === 0) {
      setSelectedOutward(new Set(defaultLondonIncludedPostcodes()));
    }
  }

  const city = coverageCityById(cityId) ?? COVERAGE_CITIES[0];
  const filteredDistricts = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return city.outwardCodes;
    return city.outwardCodes.filter((c) => c.includes(q));
  }, [city.outwardCodes, search]);

  const summary = formatPartnerCoverageSummary(partner);

  async function handleSave() {
    if (!canEdit) return;
    setSaving(true);
    try {
      if (mode === "radius") {
        if (baseLat == null || baseLng == null || !(radiusMiles > 0)) {
          toast.error("Set a base location on the map and choose a radius in miles.");
          setSaving(false);
          return;
        }
        const pc = extractUkPostcode(baseAddress) ?? (baseAddress.trim() || null);
        const updated = await updatePartner(partner.id, {
          ...clearedCoverageFieldsForMode("radius"),
          service_radius_miles: radiusMiles,
          coverage_latitude: baseLat,
          coverage_longitude: baseLng,
          coverage_base_postcode: pc,
          location: pc ?? partner.location,
        });
        onPartnerUpdate(updated);
      } else {
        const list = [...selectedOutward].map(normalizeOutwardCode).filter(Boolean);
        if (list.length === 0) {
          toast.error("Select at least one postcode district.");
          setSaving(false);
          return;
        }
        const updated = await updatePartner(partner.id, {
          ...clearedCoverageFieldsForMode("postcodes"),
          included_postcodes: list,
          coverage_cities: [cityId],
          location: city.label,
        });
        onPartnerUpdate(updated);
      }
      toast.success("Coverage saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save coverage");
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-sm text-text-secondary">{summary || "Coverage not configured."}</p>
        {mode === "radius" && baseLat != null && baseLng != null && radiusMiles > 0 ? (
          <PartnerCoverageRadiusMap
            latitude={baseLat}
            longitude={baseLng}
            radiusMiles={radiusMiles}
          />
        ) : null}
        {mode === "postcodes" && selectedOutward.size > 0 ? (
          <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
            {[...selectedOutward].sort().map((c) => (
              <span
                key={c}
                className="px-2 py-0.5 rounded-md text-xs font-medium border border-border-light bg-surface"
              >
                {c}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h3 className="text-base font-bold text-text-primary">Coverage area</h3>
        <p className="text-xs text-text-tertiary mt-1">
          How far this partner travels for work. Used for job matching and auto-assign (same rules as
          TradesPortal onboarding).
        </p>
      </div>

      <CoverageModePicker mode={mode} onChange={handleModeChange} />

      {mode === "radius" ? (
        <div className="space-y-4 rounded-xl border border-border-light bg-card p-4">
          <div>
            <p className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <MapPin className="h-4 w-4 text-text-tertiary" />
              Base location
            </p>
            <p className="text-[11px] text-text-tertiary mt-0.5">
              Pin on the map — we match jobs within your radius from this point.
            </p>
          </div>
          <LocationPicker
            restrictToUk
            value={baseAddress}
            onChange={(r) => {
              setBaseAddress(r.address);
              setBaseLat(r.lat);
              setBaseLng(r.lng);
            }}
            center={
              baseLng != null && baseLat != null ? ([baseLng, baseLat] as [number, number]) : undefined
            }
          />
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
              Radius (miles)
            </label>
            <div className="flex flex-wrap gap-2 mt-2">
              {SERVICE_RADIUS_MILE_OPTIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setRadiusMiles(m)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors",
                    radiusMiles === m
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border-light text-text-secondary hover:border-border",
                  )}
                >
                  {m} mi
                </button>
              ))}
            </div>
          </div>
          {baseLat != null && baseLng != null && radiusMiles > 0 ? (
            <PartnerCoverageRadiusMap latitude={baseLat} longitude={baseLng} radiusMiles={radiusMiles} />
          ) : null}
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-border-light bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-text-primary">Postcode districts</p>
            <div className="flex flex-wrap gap-2">
              {COVERAGE_CITIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCityId(c.id);
                    if (c.id === cityId) return;
                    setSelectedOutward(new Set());
                  }}
                  className={cn(
                    "px-3 py-1 rounded-lg text-xs font-semibold border",
                    cityId === c.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border-light text-text-secondary",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search district (e.g. SW11)"
            className="w-full h-9 px-3 rounded-lg border border-border-light text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSelectedOutward(new Set(city.outwardCodes))}
            >
              Select all {city.label}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedOutward(new Set())}>
              Clear
            </Button>
            <span className="text-xs text-text-tertiary self-center ml-auto">
              {selectedOutward.size} selected
            </span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1.5 max-h-[min(40vh,320px)] overflow-y-auto pr-1">
            {filteredDistricts.map((code) => {
              const on = selectedOutward.has(code);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => {
                    setSelectedOutward((prev) => {
                      const next = new Set(prev);
                      if (on) next.delete(code);
                      else next.add(code);
                      return next;
                    });
                  }}
                  className={cn(
                    "px-2 py-1 rounded text-xs font-medium border text-center",
                    on
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border-light text-text-secondary hover:border-border",
                  )}
                >
                  {code}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {canEdit ? (
        <div className="flex justify-end pt-2 border-t border-border-light">
          <Button type="button" loading={saving} onClick={() => void handleSave()}>
            Save coverage
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Compact coverage block for create-partner wizard (controlled state). */
export function PartnerCoverageEditor({
  mode,
  onModeChange,
  radiusMiles,
  onRadiusMilesChange,
  baseAddress,
  onBaseLocationChange,
  baseLat,
  baseLng,
  cityId,
  onCityIdChange,
  selectedOutward,
  onSelectedOutwardChange,
}: {
  mode: PartnerCoverageMode;
  onModeChange: (m: PartnerCoverageMode) => void;
  radiusMiles: number;
  onRadiusMilesChange: (n: number) => void;
  baseAddress: string;
  onBaseLocationChange: (address: string, lat: number, lng: number) => void;
  baseLat: number | null;
  baseLng: number | null;
  cityId: string;
  onCityIdChange: (id: string) => void;
  selectedOutward: Set<string>;
  onSelectedOutwardChange: (next: Set<string>) => void;
}) {
  const city = coverageCityById(cityId) ?? COVERAGE_CITIES[0];
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return city.outwardCodes;
    return city.outwardCodes.filter((c) => c.includes(q));
  }, [city.outwardCodes, search]);

  return (
    <div className="space-y-3 rounded-xl border border-border-light bg-surface-hover/30 p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Coverage area</p>
      <CoverageModePicker
        mode={mode}
        onChange={(next) => {
          if (next === mode) return;
          onModeChange(next);
        }}
      />
      {mode === "radius" ? (
        <>
          <LocationPicker
            restrictToUk
            value={baseAddress}
            onChange={(r) => onBaseLocationChange(r.address, r.lat, r.lng)}
            center={baseLng != null && baseLat != null ? [baseLng, baseLat] : undefined}
            mapHeight="180px"
          />
          <div className="flex flex-wrap gap-2">
            {SERVICE_RADIUS_MILE_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onRadiusMilesChange(m)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-semibold border",
                  radiusMiles === m ? "border-primary bg-primary/10 text-primary" : "border-border-light",
                )}
              >
                {m} mi
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="flex gap-2">
            {COVERAGE_CITIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onCityIdChange(c.id)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-semibold border",
                  cityId === c.id ? "border-primary bg-primary/10 text-primary" : "border-border-light",
                )}
              >
                {c.label}
              </button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => onSelectedOutwardChange(new Set(city.outwardCodes))}
            >
              All London
            </Button>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-1 max-h-32 overflow-y-auto">
            {filtered.slice(0, 120).map((code) => {
              const on = selectedOutward.has(code);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => {
                    const next = new Set(selectedOutward);
                    if (on) next.delete(code);
                    else next.add(code);
                    onSelectedOutwardChange(next);
                  }}
                  className={cn(
                    "px-1 py-0.5 rounded text-[10px] font-medium border",
                    on ? "border-primary text-primary" : "border-border-light text-text-tertiary",
                  )}
                >
                  {code}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-text-tertiary">{selectedOutward.size} districts selected</p>
        </>
      )}
    </div>
  );
}
