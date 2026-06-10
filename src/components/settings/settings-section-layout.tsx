"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SettingsSectionItem = {
  id: string;
  label: string;
  icon?: LucideIcon;
  count?: number;
};

type SettingsSectionNavProps = {
  groupLabel?: string;
  items: SettingsSectionItem[];
  activeId: string;
  onChange: (id: string) => void;
};

function SectionCountBadge({ count }: { count: number }) {
  return (
    <span className="ml-auto rounded-full bg-surface-tertiary px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-text-tertiary">
      {count}
    </span>
  );
}

export function SettingsSectionNav({
  groupLabel = "SETUP",
  items,
  activeId,
  onChange,
}: SettingsSectionNavProps) {
  return (
    <>
      {/* Mobile: horizontal pills */}
      <div className="lg:hidden sticky top-0 z-10 -mx-1 border-b border-border-light bg-card/95 px-1 pb-3 pt-1 backdrop-blur-sm">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {items.map((item) => {
            const Icon = item.icon;
            const active = item.id === activeId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChange(item.id)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border-light bg-surface text-text-secondary hover:border-primary/30 hover:text-text-primary",
                )}
              >
                {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
                {item.label}
                {item.count != null && item.count > 0 ? (
                  <span className="rounded-full bg-amber-500 text-white text-[10px] font-bold min-w-[1.125rem] h-[1.125rem] inline-flex items-center justify-center px-1">
                    {item.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Desktop: vertical sidebar */}
      <nav
        className="hidden lg:flex lg:flex-col lg:gap-0.5"
        aria-label={`${groupLabel} sections`}
      >
        <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
          {groupLabel}
        </p>
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors",
                active
                  ? "bg-surface-hover text-text-primary"
                  : "text-text-secondary hover:bg-surface-hover/60 hover:text-text-primary",
              )}
            >
              {Icon ? (
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    active ? "text-primary" : "text-text-tertiary",
                  )}
                />
              ) : null}
              <span className="min-w-0 truncate">{item.label}</span>
              {item.count != null && item.count > 0 ? <SectionCountBadge count={item.count} /> : null}
            </button>
          );
        })}
      </nav>
    </>
  );
}

type SettingsSectionLayoutProps = {
  groupLabel?: string;
  items: SettingsSectionItem[];
  activeId: string;
  onSectionChange: (id: string) => void;
  title: string;
  description?: string;
  children: ReactNode;
};

export function SettingsSectionLayout({
  groupLabel,
  items,
  activeId,
  onSectionChange,
  title,
  description,
  children,
}: SettingsSectionLayoutProps) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
      <div className="lg:sticky lg:top-4 lg:self-start">
        <SettingsSectionNav
          groupLabel={groupLabel}
          items={items}
          activeId={activeId}
          onChange={onSectionChange}
        />
      </div>
      <div className="min-w-0 space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-sm text-text-tertiary">{description}</p>
          ) : null}
        </div>
        <div className="space-y-3">{children}</div>
      </div>
    </div>
  );
}
