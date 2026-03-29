"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface Tab {
  id: string;
  label: string;
  count?: number;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (id: string) => void;
  variant?: "default" | "pills";
  className?: string;
}

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
                <span className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-md",
                  activeTab === tab.id ? "bg-primary/10 text-primary" : "bg-surface-secondary text-text-tertiary"
                )}>
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
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative shrink-0 whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors duration-200 text-left",
              activeTab === tab.id ? "text-primary" : "text-text-secondary hover:text-text-primary"
            )}
          >
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              {tab.label}
              {tab.count !== undefined && (
                <span className={cn(
                  "shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md",
                  activeTab === tab.id ? "bg-primary/10 text-primary" : "bg-surface-tertiary text-text-tertiary"
                )}>
                  {tab.count}
                </span>
              )}
            </span>
            {activeTab === tab.id && (
              <motion.div
                layoutId="tab-underline"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
