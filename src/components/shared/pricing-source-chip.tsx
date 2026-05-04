"use client";

import type { PriceSource } from "@/lib/job-pricing-resolver";
import { cn } from "@/lib/utils";

/**
 * Tiny chip rendered next to a price input to communicate whether the value
 * came from the catalog standard or an account/partner override.
 *
 *   <PricingSourceChip source="standard" />   →  "Standard" (subtle gray)
 *   <PricingSourceChip source="custom"   />   →  "Custom"   (amber)
 *
 * Optional `tooltip` shows up as title attribute (e.g. "Custom rate set on 12 May 2026").
 */
export function PricingSourceChip({
  source,
  tooltip,
  className,
}: {
  source: PriceSource | null | undefined;
  tooltip?: string;
  className?: string;
}) {
  if (!source) return null;
  const isCustom = source === "custom";
  return (
    <span
      title={tooltip}
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
        isCustom
          ? "bg-amber-100 text-amber-800 ring-1 ring-amber-300/70 dark:bg-amber-950/40 dark:text-amber-200"
          : "bg-surface-hover text-text-tertiary ring-1 ring-border-light",
        className,
      )}
    >
      {isCustom ? "Custom" : "Standard"}
    </span>
  );
}
