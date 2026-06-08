"use client";

import { useEffect, useMemo, useState } from "react";
import type { CatalogService } from "@/types/database";
import { formatPartnerTradeCoverageLine } from "@/lib/partner-trades-display";
import { ChevronDown, Megaphone, Sparkles, UserPlus, X } from "lucide-react";
import { AddressAutocomplete, type AddressParts } from "@/components/ui/address-autocomplete";
import { Pill } from "@/components/fx/primitives";
import { cn } from "@/lib/utils";
import { SERVICE_RADIUS_MILE_OPTIONS } from "@/lib/partner-coverage";
import { liveMapTradeFilterOptions } from "@/components/dashboard/live-map-marker-icons";
import type { CoverageSearchTarget, MatchedCoveragePartner } from "@/lib/live-map-coverage-match";

/** Short label for toolbar + status (postcode · city), not the full Mapbox string. */
export function formatScoutAreaLabel(parts: Pick<AddressParts, "postcode" | "city" | "address" | "full_address">): string {
  const pc = parts.postcode?.trim();
  const city = parts.city?.trim();
  if (pc && city) return `${pc} · ${city}`;
  if (pc) return pc;
  const street = parts.address?.trim();
  if (street && city) return `${street} · ${city}`;
  const short = parts.full_address.split(",").slice(0, 2).join(", ").trim();
  return short || parts.full_address;
}

function scoutTradeLabel(tradeFilter: "all" | string): string {
  return tradeFilter === "all" ? "All trades" : tradeFilter;
}

export type LiveMapCoverageSearchState = {
  target: CoverageSearchTarget;
  radiusMiles: number;
  matches: MatchedCoveragePartner[];
};

type Props = {
  tradeFilter: "all" | string;
  onTradeFilterChange: (value: string) => void;
  catalogTradeNames: string[];
  catalogServices: readonly CatalogService[];
  search: LiveMapCoverageSearchState | null;
  onSearchChange: (next: LiveMapCoverageSearchState | null) => void;
  defaultRadiusMiles?: number;
};

export function LiveMapCoverageScout({
  tradeFilter,
  onTradeFilterChange,
  catalogTradeNames,
  catalogServices,
  search,
  onSearchChange,
  defaultRadiusMiles = 5,
}: Props) {
  const [addressQuery, setAddressQuery] = useState("");
  const [radiusMiles, setRadiusMiles] = useState(defaultRadiusMiles);
  const [listOpen, setListOpen] = useState(false);

  const tradeOptions = useMemo(
    () => liveMapTradeFilterOptions(catalogTradeNames),
    [catalogTradeNames],
  );

  const onlineCount = search?.matches.filter((m) => m.isOnlineNow).length ?? 0;
  const totalCount = search?.matches.length ?? 0;
  const areaLabel = search?.target.label ?? "";
  const tradeLabel = scoutTradeLabel(tradeFilter);
  const radiusLabel = search?.radiusMiles ?? radiusMiles;

  useEffect(() => {
    if (!search) {
      setAddressQuery("");
      setListOpen(false);
      return;
    }
    if (search.target.label) setAddressQuery(search.target.label);
  }, [search]);

  function handleAddressSelect(parts: AddressParts) {
    if (parts.lat == null || parts.lng == null) return;
    const label = formatScoutAreaLabel(parts);
    const target: CoverageSearchTarget = {
      postcode: parts.postcode || undefined,
      latitude: parts.lat,
      longitude: parts.lng,
      label,
    };
    onSearchChange({
      target,
      radiusMiles,
      matches: [],
    });
    setAddressQuery(label);
    setListOpen(true);
  }

  function handleClear() {
    setAddressQuery("");
    onSearchChange(null);
    setListOpen(false);
  }

  const scoutFieldClass =
    "h-9 w-full appearance-none rounded-lg border border-[#D8D8DD] bg-[#FAFAFB] py-1.5 pl-2.5 pr-7 text-[11px] font-medium text-[#020040] outline-none focus:ring-2 focus:ring-[#ED4B00]/20 focus:border-[#ED4B00]/40";

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5">
      <div className="grid w-full min-w-0 grid-cols-1 gap-1.5 rounded-xl border border-[#E4E4E8] bg-white/95 px-2 py-2 shadow-md backdrop-blur-sm sm:grid-cols-12 sm:items-center sm:gap-2">
        <div className="min-w-0 sm:col-span-5">
          <AddressAutocomplete
            value={addressQuery}
            onChange={setAddressQuery}
            onSelect={handleAddressSelect}
            placeholder="Postcode or address"
            fieldClassName="!h-9 !rounded-lg !text-[12px] !pl-9 !pr-8 border-[#D8D8DD] bg-[#FAFAFB] focus:ring-[#ED4B00]/25 focus:border-[#ED4B00]/50"
            className="w-full"
          />
        </div>

        <div className="relative min-w-0 sm:col-span-2">
          <select
            aria-label="Scout radius"
            value={search?.radiusMiles ?? radiusMiles}
            onChange={(e) => {
              const n = Number(e.target.value);
              setRadiusMiles(n);
              if (search) {
                onSearchChange({ ...search, radiusMiles: n });
              }
            }}
            className={cn(scoutFieldClass, "font-semibold")}
          >
            {SERVICE_RADIUS_MILE_OPTIONS.map((mi) => (
              <option key={mi} value={mi}>
                {mi} mi
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#64748B]"
            aria-hidden
          />
        </div>

        <div className="relative min-w-0 sm:col-span-3">
          <select
            aria-label="Type of work"
            value={tradeFilter}
            onChange={(e) => onTradeFilterChange(e.target.value)}
            className={cn(
              scoutFieldClass,
              search && tradeFilter !== "all" && "border-[#ED4B00]/35 bg-[#FFF9F6] font-semibold",
            )}
          >
            {tradeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#64748B]"
            aria-hidden
          />
        </div>

        {search ? (
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex h-9 w-full shrink-0 items-center justify-center gap-1 rounded-lg border border-[#D8D8DD] bg-white px-2 text-[11px] font-medium text-[#64748B] hover:text-[#020040] sm:col-span-2"
          >
            <X className="h-3 w-3" aria-hidden />
            Clear
          </button>
        ) : (
          <div className="hidden sm:col-span-2 sm:block" aria-hidden />
        )}
      </div>

      {search ? (
        <div className="flex flex-wrap items-center gap-2 px-0.5">
          {totalCount > 0 ? (
            <button
              type="button"
              onClick={() => setListOpen((v) => !v)}
              className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-[#ED4B00]/25 bg-[#FFF7F3] px-2.5 py-1.5 text-[11px] font-semibold text-[#020040] hover:bg-[#FFEDE4]"
            >
              <span className="inline-flex items-center gap-1 text-[#ED4B00]">
                <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
                {totalCount} {tradeLabel} partner{totalCount === 1 ? "" : "s"} in {areaLabel}
              </span>
              <span className="text-[#64748B] font-medium">
                · {radiusLabel} mi radius
              </span>
              {onlineCount > 0 ? (
                <Pill tone="ok" className="!text-[9px] !py-0">
                  {onlineCount} online
                </Pill>
              ) : (
                <span className="text-[#64748B] font-medium">· none online right now</span>
              )}
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="warn" dot={false} className="!text-[10px] !py-1 !px-2.5">
                Partners available: 0
              </Pill>
              <div className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-[#FCD34D]/60 bg-gradient-to-r from-[#FFFBEB] to-[#FFF7ED] px-2.5 py-1.5 shadow-sm">
                <Megaphone className="h-3.5 w-3.5 text-[#D97706] shrink-0" aria-hidden />
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[#B45309]">
                    Time to recruit!
                  </p>
                  <p className="text-[10.5px] font-medium text-[#92400E]">
                    No {tradeLabel} coverage at {areaLabel} ({radiusLabel} mi) — grow the network here.
                  </p>
                </div>
                <UserPlus className="h-3.5 w-3.5 text-[#ED4B00] shrink-0 opacity-80" aria-hidden />
              </div>
            </div>
          )}
        </div>
      ) : null}

      {search && listOpen && totalCount > 0 ? (
        <div className="max-h-40 overflow-y-auto rounded-xl border border-[#E4E4E8] bg-white/98 shadow-md backdrop-blur-sm">
          <ul className="divide-y divide-[#F0F0F4]">
            {search.matches.map(({ partner, coverageSummary, isOnlineNow }) => (
              <li
                key={partner.id}
                className="flex items-start justify-between gap-2 px-3 py-2 text-[11px]"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-[#020040] truncate">
                    {partner.company_name?.trim() || partner.contact_name || "Partner"}
                  </p>
                  <p className="text-[#64748B] truncate">
                    {formatPartnerTradeCoverageLine(
                      partner,
                      catalogServices,
                      coverageSummary ?? "",
                    )}
                  </p>
                </div>
                <Pill tone={isOnlineNow ? "ok" : "neutral"} className="shrink-0 !text-[9px]">
                  {isOnlineNow ? "Online" : "Offline"}
                </Pill>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Apply scout target from outside (e.g. new job toast). */
export function buildCoverageSearchFromAddress(
  parts: AddressParts,
  radiusMiles: number,
): LiveMapCoverageSearchState | null {
  if (parts.lat == null || parts.lng == null) return null;
  return {
    target: {
      postcode: parts.postcode || undefined,
      latitude: parts.lat,
      longitude: parts.lng,
      label: formatScoutAreaLabel(parts),
    },
    radiusMiles,
    matches: [],
  };
}
