"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Image from "next/image";
import { Calendar, Check, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type MoneyOutPayActionsProps = {
  payLabel: string;
  disabled?: boolean;
  loading?: boolean;
  onPayNow: () => void;
  onSchedulePayment: () => void;
  onMarkAsPaid: () => void;
};

type MenuItemDef = { icon: ReactNode; label: string; onClick: () => void };

/** Wise fast-flag app icon — square, never stretched. */
function WiseIcon() {
  return (
    <span className="relative inline-block h-[18px] w-[18px] shrink-0 overflow-hidden rounded-[4px] sm:h-5 sm:w-5" aria-hidden>
      <Image
        src="/brand/wise-icon.png"
        alt=""
        fill
        sizes="20px"
        className="object-contain"
        draggable={false}
      />
    </span>
  );
}

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

type SplitVariant = "wise" | "primary";

const splitVariantStyles: Record<
  SplitVariant,
  { group: string; segment: string }
> = {
  wise: {
    group: "shadow-[0_1px_2px_rgba(22,51,0,0.12),0_4px_12px_rgba(159,232,112,0.35)]",
    segment:
      "border-[#7bc95a]/40 bg-[#9FE870] text-[#163300] hover:bg-[#92db66]",
  },
  primary: {
    group: "shadow-[0_1px_2px_rgba(237,75,0,0.15),0_4px_12px_rgba(237,75,0,0.22)]",
    segment: "border-primary/25 bg-primary text-white hover:bg-primary-hover",
  },
};

function SplitActionButton({
  variant,
  inactive,
  busy,
  onPrimary,
  primaryTitle,
  children,
  menuItems,
}: {
  variant: SplitVariant;
  inactive: boolean;
  busy: boolean;
  onPrimary: () => void;
  primaryTitle?: string;
  children: ReactNode;
  menuItems: MenuItemDef[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const styles = splitVariantStyles[variant];

  useClickOutsideMenu(menuOpen, () => setMenuOpen(false), ref);

  const run = (fn: () => void) => {
    setMenuOpen(false);
    fn();
  };

  return (
    <div ref={ref} className="relative w-fit shrink-0">
      <div
        className={cn(
          "inline-flex w-fit shrink-0 overflow-hidden rounded-[8px]",
          styles.group,
          inactive && "pointer-events-none opacity-50",
        )}
      >
        <button
          type="button"
          disabled={inactive}
          onClick={onPrimary}
          title={primaryTitle}
          className={cn(
            "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 border border-r-0 px-3",
            "whitespace-nowrap text-xs font-bold leading-none transition-colors",
            styles.segment,
          )}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : children}
        </button>
        <button
          type="button"
          disabled={inactive}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((v) => !v)}
          className={cn(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center border transition-colors",
            styles.segment,
          )}
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
              onClick={() => run(item.onClick)}
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

export function MoneyOutPayActions({
  payLabel,
  disabled,
  loading,
  onPayNow,
  onSchedulePayment,
  onMarkAsPaid,
}: MoneyOutPayActionsProps) {
  const busy = Boolean(loading);
  const inactive = disabled || busy;

  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-2 sm:w-auto sm:justify-end">
      <SplitActionButton
        variant="wise"
        inactive={inactive}
        busy={busy}
        onPrimary={onPayNow}
        primaryTitle="Pay partners via Wise"
        menuItems={[
          {
            icon: <Calendar className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />,
            label: "Schedule Payment",
            onClick: onSchedulePayment,
          },
        ]}
      >
        <WiseIcon />
        <span>Pay with Wise</span>
      </SplitActionButton>

      <SplitActionButton
        variant="primary"
        inactive={inactive}
        busy={busy}
        onPrimary={onPayNow}
        menuItems={[
          {
            icon: <Calendar className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />,
            label: "Schedule Payment",
            onClick: onSchedulePayment,
          },
          {
            icon: <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />,
            label: "Mark as Paid",
            onClick: onMarkAsPaid,
          },
        ]}
      >
        <span>{payLabel}</span>
      </SplitActionButton>
    </div>
  );
}
