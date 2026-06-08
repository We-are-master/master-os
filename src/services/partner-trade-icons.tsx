"use client";

import type { CatalogService } from "@/types/database";
import {
  SERVICE_ICON_CELL_CLASSES,
  SERVICE_ICON_INNER_CLASSES,
  resolveServiceDisplayIcon,
  suggestSlugFromServiceName,
  entryForSlug,
  type PartnerTradeIconEntry,
} from "@/lib/service-display-icons";
import { cn } from "@/lib/utils";
import { useMemo, useRef, useState } from "react";

export type { PartnerTradeIconEntry };

/** Fallback when catalogue row is unknown (label-only heuristic). */
export function tradeIconForLabel(label: string): PartnerTradeIconEntry {
  return entryForSlug(suggestSlugFromServiceName(label));
}

function catalogByNameLc(
  catalogServices: CatalogService[] | readonly CatalogService[],
): Map<string, CatalogService> {
  const m = new Map<string, CatalogService>();
  for (const s of catalogServices) {
    const k = String(s.name ?? "").trim().toLowerCase();
    if (k) m.set(k, s);
  }
  return m;
}

function tradeDisplayLabel(trade: string, row: CatalogService | null | undefined): string {
  return row?.name?.trim() || String(trade).trim() || "Trade";
}

function TradeIconBadge({
  trade,
  byLc,
  tooltipPlacement = "bottom",
}: {
  trade: string;
  index?: number;
  byLc: Map<string, CatalogService> | null;
  /** Below avoids clipping in table rows; above for overflow “+N” panel. */
  tooltipPlacement?: "top" | "bottom";
}) {
  const k = String(trade).trim().toLowerCase();
  const row = byLc?.get(k);
  const label = tradeDisplayLabel(trade, row);
  const { Icon } = resolveServiceDisplayIcon({ tradeLabel: trade, catalogService: row ?? undefined });
  const tipPos =
    tooltipPlacement === "top"
      ? "bottom-full left-1/2 mb-1.5 -translate-x-1/2"
      : "top-full left-1/2 mt-1.5 -translate-x-1/2";

  return (
    <div className="group/trade-tip relative shrink-0">
      <span
        className={cn(SERVICE_ICON_CELL_CLASSES, "cursor-default")}
        aria-label={label}
        title={label}
      >
        <Icon className={SERVICE_ICON_INNER_CLASSES} aria-hidden />
      </span>
      <div
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-[80] hidden whitespace-nowrap rounded-md border border-border-light",
          "bg-card px-2 py-1 text-[10px] font-semibold text-text-primary shadow-md",
          "group-hover/trade-tip:block group-focus-within/trade-tip:block",
          tipPos,
        )}
      >
        {label}
      </div>
    </div>
  );
}

export function PartnerTradesIconStrip({
  trades,
  catalogServices,
  className,
  maxVisible,
}: {
  trades: string[];
  /** When provided, resolves `display_icon_key` per catalogue name match. */
  catalogServices?: CatalogService[] | readonly CatalogService[];
  className?: string;
  /** Show up to N icons, then a "+" hover panel with every trade. */
  maxVisible?: number;
}) {
  const byLc = useMemo(
    () => (catalogServices?.length ? catalogByNameLc(catalogServices) : null),
    [catalogServices],
  );

  const list = trades.filter(Boolean);
  if (list.length === 0) return <span className="text-xs text-text-tertiary">—</span>;

  const cap = maxVisible != null && maxVisible > 0 ? maxVisible : list.length;
  const hasOverflow = list.length > cap;
  const visible = hasOverflow ? list.slice(0, cap) : list;
  const hiddenCount = hasOverflow ? list.length - cap : 0;
  const hiddenTrades = hasOverflow ? list.slice(cap) : [];
  const title = list.join(" · ");
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className={cn(
        "flex items-center gap-0.5",
        maxVisible == null && "max-w-[min(100%,20rem)] flex-nowrap overflow-x-auto [scrollbar-width:thin]",
        className,
      )}
      title={maxVisible == null ? title : undefined}
    >
      {visible.map((t, i) => (
        <TradeIconBadge key={`vis-${i}`} trade={t} byLc={byLc} tooltipPlacement="bottom" />
      ))}
      {hasOverflow ? (
        <div
          ref={overflowRef}
          className="relative shrink-0"
          onMouseEnter={() => setOverflowOpen(true)}
          onMouseLeave={() => setOverflowOpen(false)}
        >
          <button
            type="button"
            aria-expanded={overflowOpen}
            aria-label={`${hiddenCount} more trades: ${hiddenTrades.join(", ")}`}
            title={hiddenTrades.join(" · ")}
            onClick={() => setOverflowOpen((v) => !v)}
            className={cn(
              SERVICE_ICON_CELL_CLASSES,
              "cursor-pointer text-[10px] font-bold text-text-secondary transition-colors",
              "hover:border-primary/30 hover:bg-primary/[0.06] hover:text-primary",
              overflowOpen && "border-primary/30 bg-primary/[0.06] text-primary",
            )}
          >
            +{hiddenCount}
          </button>
          {overflowOpen ? (
            <div
              role="tooltip"
              className={cn(
                "absolute top-full left-1/2 z-[90] mt-1.5 -translate-x-1/2",
                "rounded-lg border border-border-light bg-card px-2 py-1.5 shadow-lg",
              )}
              onMouseEnter={() => setOverflowOpen(true)}
              onMouseLeave={() => setOverflowOpen(false)}
            >
              <div className="flex flex-nowrap items-center gap-0.5 max-w-[min(16rem,70vw)] overflow-x-auto [scrollbar-width:thin]">
                {hiddenTrades.map((t, i) => (
                  <TradeIconBadge key={`more-${i}`} trade={t} byLc={byLc} tooltipPlacement="bottom" />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
