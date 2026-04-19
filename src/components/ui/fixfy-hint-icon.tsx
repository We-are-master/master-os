"use client";

import { cn } from "@/lib/utils";

export interface FixfyHintIconProps {
  /** Hint copy (rich tooltip + aria-label). */
  text: string;
  className?: string;
  /** Use native `title` only (no dark hover panel). */
  nativeTitleOnly?: boolean;
}

/**
 * Fixfy informational hint: “!” in a 14×14 grey circle (#ECECEE / #6B6B70).
 * Default: dark tooltip on hover/focus (same behavior as KPI / page header hints).
 */
export function FixfyHintIcon({ text, className, nativeTitleOnly = false }: FixfyHintIconProps) {
  const circle = (
    <span
      tabIndex={nativeTitleOnly ? undefined : 0}
      aria-label={text}
      title={nativeTitleOnly ? text : undefined}
      className="inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full text-[10px] font-medium leading-none cursor-help outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
      style={{ background: "#ECECEE", color: "#6B6B70", fontSize: "10px", fontWeight: 500 }}
    >
      !
    </span>
  );

  if (nativeTitleOnly) {
    return <span className={cn("inline-flex", className)}>{circle}</span>;
  }

  return (
    <span className={cn("group relative inline-flex", className)}>
      {circle}
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute top-full left-0 z-[60] mt-1 max-w-xs whitespace-pre-wrap rounded bg-[#1a1a1a] px-2 py-1.5 text-[10px] font-normal leading-snug text-white opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
