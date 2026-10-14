"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import type { JobsManagementTabAccent } from "@/lib/job-status-ui";

interface Tab {
  id: string;
  label: string;
  count?: number;
  /** When set (Jobs management), active tab underline + count chip use this colour family. */
  accent?: JobsManagementTabAccent;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (id: string) => void;
  variant?: "default" | "quote-drawer";
  className?: string;
}

/**
 * Fixfy OS UNO tabs (VOS UNO §11): every tab looks the same. Inactive 500
 * `text-tertiary`, active 600 `text-primary` with the 2px coral rule; counts are
 * plain 11px text. The per-tab accents are kept as a type only so call sites compile.
 */
const UNO_TAB = {
  activeText: "text-text-primary font-semibold",
  line: "bg-[var(--accent)]",
  countActive: "text-text-tertiary",
  countInactive: "text-text-tertiary",
};
const TAB_ACCENT: Record<
  JobsManagementTabAccent,
  { activeText: string; line: string; countActive: string; countInactive: string }
> = {
  neutral: UNO_TAB,
  red: UNO_TAB,
  green: UNO_TAB,
  blue: UNO_TAB,
  violet: UNO_TAB,
  amber: UNO_TAB,
  emerald: UNO_TAB,
  slate: UNO_TAB,
};

export function Tabs({ tabs, activeTab, onChange, variant = "default", className }: TabsProps) {
  if (variant === "quote-drawer") {
    return (
      <div
        className={cn(
          "flex h-10 shrink-0 items-stretch gap-2 border-b border-fx-line px-6",
          className,
        )}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative inline-flex items-center gap-2 px-[11px] py-2 text-[13px] font-medium transition-colors",
              activeTab === tab.id ? "text-fx-ink font-semibold" : "text-fx-mute hover:text-fx-ink",
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span
                className={cn(
                  "text-[11px] font-medium tabular-nums text-fx-mute",
                )}
              >
                {tab.count}
              </span>
            ) : null}
            {activeTab === tab.id ? (
              <motion.div
                layoutId="quote-drawer-tab-underline"
                className="absolute -bottom-px left-[11px] right-[11px] h-0.5 rounded-t-sm bg-fx-coral"
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
              />
            ) : null}
          </button>
        ))}
      </div>
    );
  }


  return (
    <div
      className={cn(
        "w-full min-w-0 overflow-x-auto overscroll-x-contain scroll-smooth snap-x snap-mandatory",
        "[scrollbar-width:thin] [-webkit-overflow-scrolling:touch]",
        className?.includes("border-b-0") ? "" : "border-b border-border",
        className,
      )}
    >
      <div className="inline-flex h-10 flex-nowrap items-stretch gap-2 min-w-max -ml-[11px]">
        {tabs.map((tab) => {
          const accent = tab.accent ? TAB_ACCENT[tab.accent] : TAB_ACCENT.neutral;
          return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative shrink-0 snap-start whitespace-nowrap px-[11px] py-2 text-[13px] font-medium transition-colors duration-150 text-left",
              activeTab === tab.id ? accent.activeText : "text-text-tertiary hover:text-text-primary"
            )}
          >
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={cn(
                    "shrink-0 text-[11px] font-medium tabular-nums",
                    activeTab === tab.id ? accent.countActive : accent.countInactive,
                  )}
                >
                  {tab.count}
                </span>
              )}
            </span>
            {activeTab === tab.id && (
              <motion.div
                layoutId="tab-underline"
                className={cn("absolute -bottom-px left-[11px] right-[11px] h-0.5 rounded-t-sm", accent.line)}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
              />
            )}
          </button>
        );
        })}
      </div>
    </div>
  );
}
