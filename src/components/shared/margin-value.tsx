"use client";

import { cn, formatCurrency } from "@/lib/utils";
import { useFrontendSetup } from "@/hooks/use-frontend-setup";
import { marginColorClass } from "@/lib/frontend-setup";

/**
 * Margin, the way the OS shows margin: the money first, the percentage right
 * beside it. It used to be stacked in two lines, which cost a row of height
 * everywhere it appeared and read as two separate numbers instead of one fact.
 *
 * The colour comes from the configured thresholds (Settings → Setup → Margin
 * Targets), so a healthy margin looks the same on every screen. A negative
 * margin is always red, whatever the thresholds say.
 */
export function MarginValue({
  value,
  pct,
  size = "sm",
  className,
}: {
  /** Margin in pounds. */
  value: number;
  /** Margin percentage, or null when there is nothing to divide by. */
  pct: number | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const { marginThresholds } = useFrontendSetup();
  const negative = value < 0;
  const tone = negative
    ? "text-fx-red"
    : pct == null
      ? "text-text-secondary"
      : marginColorClass(pct, marginThresholds);

  return (
    <span
      className={cn("inline-flex items-baseline gap-1.5 tabular-nums leading-tight", className)}
      title={
        pct == null
          ? "Margin"
          : `Margin · target ≥${marginThresholds.targetPct}% · low <${marginThresholds.lowPct}%`
      }
    >
      {/* Same size for both: the money and the percentage are one fact. */}
      <span className={cn("font-semibold", size === "md" ? "text-sm" : "text-[11px]", tone)}>
        {formatCurrency(value)}
      </span>
      {pct == null ? null : (
        <span className={cn("font-semibold", size === "md" ? "text-sm" : "text-[11px]", tone, "opacity-70")}>
          {pct}%
        </span>
      )}
    </span>
  );
}
