"use client";

import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { STAGE_LABEL } from "@/lib/crm/etapas";
import type { CrmTab, SegmentFilter } from "@/services/crm-leads";

const TAB_ORDER: CrmTab[] = ["today", "open", "new", "talking", "quoting", "quote_sent", "accepted", "won", "nurture", "lost"];

export function LeadStageTabs({
  active,
  counts,
  todayCount,
  onChange,
}: {
  active: CrmTab;
  counts: Record<string, number>;
  todayCount: number;
  onChange: (tab: CrmTab) => void;
}) {
  const tabs = TAB_ORDER.map((id) => ({
    id,
    label: id === "today" ? "Today" : id === "open" ? "Open" : STAGE_LABEL[id],
    count: id === "today" ? todayCount : (counts[id] ?? 0),
    hint:
      id === "today"
        ? "Open leads that need someone now: customer replied, new and unanswered, next action overdue, or no next action."
        : undefined,
  }));
  return (
    <div className="min-w-0 -mx-1 px-1 overflow-x-auto">
      <Tabs tabs={tabs} activeTab={active} onChange={(id) => onChange(id as CrmTab)} className="min-w-max sm:min-w-0" />
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-7 items-center rounded-md px-3 text-[12px] font-semibold transition-colors",
            value === o.value ? "bg-primary text-white shadow-sm" : "text-text-secondary hover:text-text-primary",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SegmentToggle({ value, onChange }: { value: SegmentFilter; onChange: (v: SegmentFilter) => void }) {
  return (
    <Segmented
      label="Segment"
      value={value}
      onChange={onChange}
      options={[
        { value: "all", label: "All" },
        { value: "b2c", label: "B2C" },
        { value: "b2b", label: "B2B" },
      ]}
    />
  );
}

export type LeadsView = "board" | "list";

export function ViewToggle({ value, onChange }: { value: LeadsView; onChange: (v: LeadsView) => void }) {
  return (
    <Segmented
      label="View"
      value={value}
      onChange={onChange}
      options={[
        { value: "board", label: "Board" },
        { value: "list", label: "List" },
      ]}
    />
  );
}
