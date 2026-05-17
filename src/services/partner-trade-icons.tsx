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

export function PartnerTradesIconStrip({
  trades,
  catalogServices,
  className,
}: {
  trades: string[];
  /** When provided, resolves `display_icon_key` per catalogue name match. */
  catalogServices?: CatalogService[] | readonly CatalogService[];
  className?: string;
}) {
  const byLc = useMemo(
    () => (catalogServices?.length ? catalogByNameLc(catalogServices) : null),
    [catalogServices],
  );

  const list = trades.filter(Boolean);
  if (list.length === 0) return <span className="text-xs text-text-tertiary">—</span>;

  const title = list.join(" · ");

  return (
    <div
      className={cn(
        "flex max-w-[min(100%,20rem)] flex-nowrap items-center gap-0.5 overflow-x-auto [scrollbar-width:thin]",
        className,
      )}
      title={title}
    >
      {list.map((t, i) => {
        const k = String(t).trim().toLowerCase();
        const row = byLc?.get(k);
        const { Icon } = resolveServiceDisplayIcon({ tradeLabel: t, catalogService: row ?? undefined });
        return (
          <span key={`${k}-${i}`} title={t} className={SERVICE_ICON_CELL_CLASSES}>
            <Icon className={SERVICE_ICON_INNER_CLASSES} aria-hidden />
            <span className="sr-only">{t}</span>
          </span>
        );
      })}
    </div>
  );
}
