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
  variant?: "default" | "pills";
  className?: string;
}

const TAB_ACCENT: Record<
  JobsManagementTabAccent,
  { activeText: string; line: string; countActive: string; countInactive: string }
> = {
  neutral: {
    activeText: "text-primary",
    line: "bg-primary",
    countActive: "bg-primary/10 text-primary",
    countInactive: "bg-surface-tertiary text-text-tertiary",
  },
  red: {
    activeText: "text-red-600 dark:text-red-400",
    line: "bg-red-500",
    countActive: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200",
    countInactive: "bg-red-50/90 text-red-700/80 dark:bg-red-950/25 dark:text-red-300/80",
  },
  green: {
    activeText: "text-emerald-600 dark:text-emerald-400",
    line: "bg-emerald-500",
    countActive: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
    countInactive: "bg-emerald-50/90 text-emerald-800/80 dark:bg-emerald-950/25 dark:text-emerald-300/80",
  },
  blue: {
    activeText: "text-blue-600 dark:text-blue-400",
    line: "bg-blue-500",
    countActive: "bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200",
    countInactive: "bg-blue-50/90 text-blue-800/80 dark:bg-blue-950/25 dark:text-blue-300/80",
  },
  violet: {
    activeText: "text-violet-600 dark:text-violet-400",
    line: "bg-violet-500",
    countActive: "bg-violet-100 text-violet-900 dark:bg-violet-950/50 dark:text-violet-200",
    countInactive: "bg-violet-50/90 text-violet-800/80 dark:bg-violet-950/25 dark:text-violet-300/80",
  },
  amber: {
    activeText: "text-amber-600 dark:text-amber-400",
    line: "bg-amber-500",
    countActive: "bg-amber-100 text-amber-950 dark:bg-amber-950/35 dark:text-amber-200",
    countInactive: "bg-amber-50/90 text-amber-900/80 dark:bg-amber-950/25 dark:text-amber-300/80",
  },
  emerald: {
    activeText: "text-emerald-600 dark:text-emerald-400",
    line: "bg-emerald-600",
    countActive: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
    countInactive: "bg-emerald-50/90 text-emerald-800/80 dark:bg-emerald-950/25 dark:text-emerald-300/80",
  },
  slate: {
    activeText: "text-slate-600 dark:text-slate-400",
    line: "bg-slate-500",
    countActive: "bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100",
    countInactive: "bg-slate-100 text-slate-600 dark:bg-slate-800/50 dark:text-slate-400",
  },
};

export function Tabs({ tabs, activeTab, onChange, variant = "default", className }: TabsProps) {
  if (variant === "pills") {
    return (
      <div className={cn("inline-flex max-w-full flex-nowrap items-center gap-1.5 overflow-x-auto p-1 bg-surface-tertiary rounded-xl [scrollbar-width:thin]", className)}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative shrink-0 whitespace-nowrap px-3.5 py-1.5 text-sm font-medium rounded-lg transition-colors duration-200",
              activeTab === tab.id ? "text-text-primary" : "text-text-secondary hover:text-text-primary"
            )}
          >
            {activeTab === tab.id && (
              <motion.div
                layoutId="pill-tab"
                className="absolute inset-0 bg-card rounded-lg shadow-sm"
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5 whitespace-nowrap">
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded-md",
                    tab.accent
                      ? activeTab === tab.id
                        ? TAB_ACCENT[tab.accent].countActive
                        : TAB_ACCENT[tab.accent].countInactive
                      : activeTab === tab.id
                        ? TAB_ACCENT.neutral.countActive
                        : TAB_ACCENT.neutral.countInactive,
                  )}
                >
                  {tab.count}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("w-full min-w-0 overflow-x-auto border-b border-border [scrollbar-width:thin]", className)}>
      <div className="inline-flex flex-nowrap items-stretch gap-0">
        {tabs.map((tab) => {
          const accent = tab.accent ? TAB_ACCENT[tab.accent] : TAB_ACCENT.neutral;
          return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative shrink-0 whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors duration-200 text-left",
              activeTab === tab.id ? accent.activeText : "text-text-secondary hover:text-text-primary"
            )}
          >
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={cn(
                    "shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md",
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
                className={cn("absolute bottom-0 left-0 right-0 h-0.5", accent.line)}
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
