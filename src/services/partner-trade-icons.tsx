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
import { useMemo } from "react";

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

function TradeIconBadge({
  trade,
  index,
  byLc,
}: {
  trade: string;
  index: number;
  byLc: Map<string, CatalogService> | null;
}) {
  const k = String(trade).trim().toLowerCase();
  const row = byLc?.get(k);
  const { Icon } = resolveServiceDisplayIcon({ tradeLabel: trade, catalogService: row ?? undefined });
  return (
    <span title={trade} className={SERVICE_ICON_CELL_CLASSES}>
      <Icon className={SERVICE_ICON_INNER_CLASSES} aria-hidden />
      <span className="sr-only">{trade}</span>
    </span>
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
  const title = list.join(" · ");

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
        <TradeIconBadge key={`vis-${i}`} trade={t} index={i} byLc={byLc} />
      ))}
      {hasOverflow ? (
        <div className="group/trade-more relative shrink-0">
          <span
            className={cn(
              SERVICE_ICON_CELL_CLASSES,
              "cursor-default text-[10px] font-bold text-text-secondary hover:border-primary/30 hover:bg-primary/[0.06] hover:text-primary",
            )}
            aria-label={`${hiddenCount} more trades: ${list.slice(cap).join(", ")}`}
          >
            +{hiddenCount}
          </span>
          <div
            role="tooltip"
            className={cn(
              "pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden -translate-x-1/2",
              "group-hover/trade-more:flex",
            )}
          >
            <div className="flex max-w-[14rem] flex-wrap items-center justify-center gap-0.5 rounded-lg border border-border-light bg-card px-2 py-1.5 shadow-lg">
              {list.map((t, i) => (
                <TradeIconBadge key={`all-${i}`} trade={t} index={i} byLc={byLc} />
              ))}
            </div>
            <p className="mt-1 max-w-[14rem] text-center text-[9px] font-medium leading-snug text-text-tertiary">
              {title}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
