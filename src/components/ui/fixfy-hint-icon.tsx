"use client";

import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

type Placement = NonNullable<FixfyHintIconProps["placement"]>;

const TOOLTIP_MAX_WIDTH = 320;
const VIEWPORT_MARGIN = 8;
const GAP = 6;

function preferredCoords(
  rect: DOMRect,
  placement: Placement,
  width: number,
  height: number,
): { top: number; left: number } {
  switch (placement) {
    case "bottom-end":
      return { top: rect.bottom + GAP, left: rect.right - width };
    case "top-start":
      return { top: rect.top - GAP - height, left: rect.left };
    case "top-end":
      return { top: rect.top - GAP - height, left: rect.right - width };
    case "bottom-start":
    default:
      return { top: rect.bottom + GAP, left: rect.left };
  }
}

function clampCoords(
  top: number,
  left: number,
  width: number,
  height: number,
): { top: number; left: number } {
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
  const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
  return {
    top: Math.min(Math.max(top, VIEWPORT_MARGIN), maxTop),
    left: Math.min(Math.max(left, VIEWPORT_MARGIN), maxLeft),
  };
}

/**
 * Fixfy informational hint: "!" in a small circle. Hover/focus shows a portal
 * tooltip (never clipped by overflow-hidden parents). Click opens a readable modal.
 */
export function FixfyHintIcon({
  text,
  label,
  className,
  nativeTitleOnly = false,
  placement = "bottom-start",
}: FixfyHintIconProps) {
  const tooltipId = useId();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const popover = popoverRef.current;
    const width = Math.min(TOOLTIP_MAX_WIDTH, popover?.offsetWidth || TOOLTIP_MAX_WIDTH);
    const height = popover?.offsetHeight || 120;

    let { top, left } = preferredCoords(rect, placement, width, height);
    let clamped = clampCoords(top, left, width, height);

    const overflowsBottom = top + height > window.innerHeight - VIEWPORT_MARGIN;
    const overflowsTop = top < VIEWPORT_MARGIN;
    if (placement.startsWith("bottom") && overflowsBottom && rect.top - GAP - height >= VIEWPORT_MARGIN) {
      top = rect.top - GAP - height;
      clamped = clampCoords(top, left, width, height);
    } else if (placement.startsWith("top") && overflowsTop && rect.bottom + GAP + height <= window.innerHeight - VIEWPORT_MARGIN) {
      top = rect.bottom + GAP;
      clamped = clampCoords(top, left, width, height);
    }

    setCoords(clamped);
  }, [placement]);

  useLayoutEffect(() => {
    if (!tooltipOpen) {
      return;
    }
    updatePosition();
  }, [tooltipOpen, text, label, updatePosition]);

  useEffect(() => {
    if (!tooltipOpen) {
      setCoords(null);
    }
  }, [tooltipOpen]);

  useEffect(() => {
    if (!tooltipOpen) return;

    const onReposition = () => updatePosition();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [tooltipOpen, updatePosition]);

  const clearHideTimer = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  };

  const handleEnter = () => {
    clearHideTimer();
    const anchor = anchorRef.current;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      const estimate = preferredCoords(rect, placement, TOOLTIP_MAX_WIDTH, 96);
      setCoords(clampCoords(estimate.top, estimate.left, TOOLTIP_MAX_WIDTH, 96));
    }
    setTooltipOpen(true);
  };

  const handleLeave = () => {
    clearHideTimer();
    hideTimer.current = setTimeout(() => setTooltipOpen(false), 120);
  };

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    clearHideTimer();
    setTooltipOpen(false);
    setModalOpen(true);
  };

  const circle = (
    <button
      ref={anchorRef}
      type="button"
      tabIndex={nativeTitleOnly ? -1 : 0}
      aria-label={text}
      aria-describedby={tooltipOpen ? tooltipId : undefined}
      aria-haspopup="dialog"
      title={nativeTitleOnly ? text : undefined}
      onClick={nativeTitleOnly ? undefined : handleClick}
      className={cn(
        "inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full bg-fx-line/70 text-fx-mute font-mono text-[10px] font-semibold leading-none cursor-help outline-none transition-colors",
        "hover:bg-fx-coral/10 hover:text-fx-coral focus-visible:ring-2 focus-visible:ring-fx-coral/30",
      )}
    >
      !
    </button>
  );

  if (nativeTitleOnly) {
    return <span className={cn("inline-flex", className)}>{circle}</span>;
  }

  const tooltip =
    tooltipOpen && mounted && coords
      ? createPortal(
          <span
            ref={popoverRef}
            id={tooltipId}
            role="tooltip"
            style={{ top: coords.top, left: coords.left, maxWidth: TOOLTIP_MAX_WIDTH }}
            className={cn(
              "fixed z-[200] w-max rounded-lg border border-fx-line bg-card shadow-fx-2 p-3.5 text-[13px] leading-[1.55] text-text-primary cursor-default whitespace-pre-wrap break-words",
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
          </span>,
          document.body,
        )
      : null;

  return (
    <>
      <span
        className={cn("relative inline-flex", className)}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocus={handleEnter}
        onBlur={handleLeave}
      >
        {circle}
      </span>
      {tooltip}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={label ?? "Info"}
        size="sm"
        rootClassName="z-[210]"
      >
        <p className="px-5 py-4 text-[14px] leading-[1.6] text-text-primary whitespace-pre-wrap break-words">
          {text}
        </p>
      </Modal>
    </>
  );
}
