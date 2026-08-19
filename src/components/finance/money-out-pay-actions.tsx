"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Calendar, Check, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Money Out · Ready actions. Wise payout was removed from this surface (not in
 * use for now) — paying is recorded with Mark as paid, and Schedule Payment
 * lives in the split menu. If Wise comes back, restore the split variant from
 * git history rather than re-inventing it.
 */
type MoneyOutPayActionsProps = {
  disabled?: boolean;
  loading?: boolean;
  onSchedulePayment: () => void;
  onMarkAsPaid: () => void;
};

type MenuItemDef = { icon: ReactNode; label: string; onClick: () => void };

function useClickOutsideMenu(open: boolean, onClose: () => void, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, ref]);
}

export function MoneyOutPayActions({
  disabled,
  loading,
  onSchedulePayment,
  onMarkAsPaid,
}: MoneyOutPayActionsProps) {
  const busy = Boolean(loading);
  const inactive = disabled || busy;
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useClickOutsideMenu(menuOpen, () => setMenuOpen(false), ref);

  const menuItems: MenuItemDef[] = [
    {
      icon: <Calendar className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />,
      label: "Schedule Payment",
      onClick: onSchedulePayment,
    },
  ];

  const segment =
    "border-emerald-600/20 bg-emerald-500 text-white hover:bg-emerald-600 transition-colors";

  return (
    <div ref={ref} className="relative w-fit shrink-0">
      <div
        className={cn(
          "inline-flex w-fit shrink-0 overflow-hidden rounded-[8px]",
          "shadow-[0_1px_2px_rgba(16,185,129,0.2),0_4px_12px_rgba(16,185,129,0.25)]",
          inactive && "pointer-events-none opacity-50",
        )}
      >
        <button
          type="button"
          disabled={inactive}
          onClick={onMarkAsPaid}
          title="Record these self-bills as paid"
          className={cn(
            "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 border border-r-0 px-3",
            "whitespace-nowrap text-xs font-bold leading-none",
            segment,
          )}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
          )}
          Mark as paid
        </button>
        <button
          type="button"
          disabled={inactive}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((v) => !v)}
          className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center border", segment)}
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", menuOpen && "rotate-180")} />
        </button>
      </div>

      {menuOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-50 min-w-[196px] overflow-hidden rounded-[10px] border border-border-light bg-white py-1 shadow-lg"
        >
          {menuItems.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-text-primary hover:bg-surface-hover/80"
              onClick={() => {
                setMenuOpen(false);
                item.onClick();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
