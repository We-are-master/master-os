import { cn } from "@/lib/utils";
import type { PricingDelta } from "@/lib/catalog-pricing-floor-ceiling";

export function PricingDeltaChip({ delta, className }: { delta: PricingDelta; className?: string }) {
  return (
    <span
      className={cn(
        "text-[10px] font-medium",
        delta.valid ? "text-text-tertiary" : "text-red-600 dark:text-red-400",
        className,
      )}
    >
      Standard £{delta.standard.toFixed(2)}
      {" · "}
      {delta.label}
    </span>
  );
}
