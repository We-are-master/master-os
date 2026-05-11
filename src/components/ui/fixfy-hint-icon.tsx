"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

export interface FixfyHintIconProps {
  /** Hint copy (rich tooltip + aria-label). */
  text: string;
  /** Optional eyebrow label rendered above the body in the popover (uppercase mono). */
  label?: string;
  className?: string;
  /** Use native `title` only (no styled popover). */
  nativeTitleOnly?: boolean;
  /** Anchor of the popover relative to the icon. Default: bottom-start. */
  placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
}

/**
 * Fixfy informational hint: "!" in a small circle that reveals a styled hover
 * popover (white card · fx-line border · shadow-fx-2). The icon hue lifts to
 * coral on hover to signal it's interactive. Same lazy show/hide pattern as
 * the Zendesk ticket badge popover.
 */
export function FixfyHintIcon({
  text,
  label,
  className,
  nativeTitleOnly = false,
  placement = "bottom-start",
}: FixfyHintIconProps) {
  const [open, setOpen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const circle = (
    <span
      tabIndex={nativeTitleOnly ? undefined : 0}
      aria-label={text}
      title={nativeTitleOnly ? text : undefined}
      className={cn(
        "inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full bg-fx-line/70 text-fx-mute font-mono text-[10px] font-semibold leading-none cursor-help outline-none transition-colors",
        "hover:bg-fx-coral/10 hover:text-fx-coral focus-visible:ring-2 focus-visible:ring-fx-coral/30",
      )}
    >
      !
    </span>
  );

  if (nativeTitleOnly) {
    return <span className={cn("inline-flex", className)}>{circle}</span>;
  }

  const positionClass = (() => {
    switch (placement) {
      case "bottom-end":
        return "top-full right-0 mt-1.5";
      case "top-start":
        return "bottom-full left-0 mb-1.5";
      case "top-end":
        return "bottom-full right-0 mb-1.5";
      case "bottom-start":
      default:
        return "top-full left-0 mt-1.5";
    }
  })();

  const handleEnter = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setOpen(true);
  };
  const handleLeave = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      {circle}
      {open && (
        <span
          role="tooltip"
          className={cn(
            "absolute z-[60] w-max max-w-[280px] rounded-lg border border-fx-line bg-card shadow-fx-2 p-3 text-[12px] leading-[1.5] text-text-secondary cursor-default whitespace-pre-wrap break-words",
            positionClass,
          )}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          {label ? (
            <span className="block font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-fx-mute mb-1.5">
              {label}
            </span>
          ) : null}
          {text}
        </span>
      )}
    </span>
  );
}
