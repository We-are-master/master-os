"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { MicroLabel } from "@/components/fx/primitives";

export type BeaconDateMode = "today" | "tomorrow" | "week" | "month" | "qtd" | "all" | "custom";

export type BeaconFilters = {
  dateMode: BeaconDateMode;
  customFrom: string;
  customTo: string;
  partnerId: string; // "all" · "__unassigned__" · partner_id
};

export const DEFAULT_BEACON_FILTERS: BeaconFilters = {
  dateMode: "today",
  customFrom: "",
  customTo: "",
  partnerId: "all",
};

const DATE_OPTIONS: { id: BeaconDateMode; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "week", label: "This Week" },
  { id: "month", label: "This Month" },
  { id: "qtd", label: "QTD" },
  { id: "all", label: "All Time" },
  { id: "custom", label: "Custom" },
];

type Props = {
  filters: BeaconFilters;
  onChange: (next: BeaconFilters) => void;
};

export function BeaconFiltersButton({ filters, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [partners, setPartners] = useState<{ id: string; name: string }[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      const supabase = getSupabase();
      const { data } = await supabase
        .from("jobs")
        .select("partner_id, partner_name")
        .not("partner_id", "is", null)
        .not("partner_name", "is", null)
        .neq("status", "cancelled")
        .is("deleted_at", null)
        .limit(2000);
      type Row = { partner_id: string | null; partner_name: string | null };
      const seen = new Map<string, string>();
      for (const r of (data ?? []) as Row[]) {
        const id = r.partner_id?.trim();
        const name = r.partner_name?.trim();
        if (!id || !name) continue;
        if (!seen.has(id)) seen.set(id, name);
      }
      setPartners(
        Array.from(seen.entries())
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    })();
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeCount =
    (filters.dateMode !== "all" ? 1 : 0) + (filters.partnerId !== "all" ? 1 : 0);

  const partnerLabel = (() => {
    if (filters.partnerId === "all") return "All Partners";
    if (filters.partnerId === "__unassigned__") return "Unassigned Only";
    return partners.find((p) => p.id === filters.partnerId)?.name ?? "Partner";
  })();

  const dateLabel = DATE_OPTIONS.find((o) => o.id === filters.dateMode)?.label ?? "Range";

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-[7px] rounded-md text-[13px] font-medium border transition-colors",
          activeCount > 0
            ? "bg-fx-coral/5 border-fx-coral/30 text-fx-coral-p"
            : "bg-card text-text-primary border-fx-line hover:bg-fx-paper",
        )}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Filter
        {activeCount > 0 && (
          <span className="font-mono text-[10.5px] bg-fx-coral/15 px-1.5 py-0.5 rounded-sm">
            {activeCount}
          </span>
        )}
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-[300px] rounded-xl border border-fx-line bg-card shadow-fx-2 p-3 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-2">
              <MicroLabel>Date</MicroLabel>
              <span className="text-[11px] text-fx-mute">{dateLabel}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DATE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onChange({ ...filters, dateMode: opt.id })}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors border",
                    filters.dateMode === opt.id
                      ? "bg-fx-coral text-white border-fx-coral"
                      : "bg-card border-fx-line text-text-primary hover:bg-fx-paper",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {filters.dateMode === "custom" && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <MicroLabel className="block mb-1">From</MicroLabel>
                  <input
                    type="date"
                    value={filters.customFrom}
                    onChange={(e) => onChange({ ...filters, customFrom: e.target.value })}
                    className="w-full h-8 text-[12px] px-2 rounded-md border border-fx-line bg-card outline-none focus:border-fx-coral"
                  />
                </div>
                <div>
                  <MicroLabel className="block mb-1">To</MicroLabel>
                  <input
                    type="date"
                    value={filters.customTo}
                    onChange={(e) => onChange({ ...filters, customTo: e.target.value })}
                    className="w-full h-8 text-[12px] px-2 rounded-md border border-fx-line bg-card outline-none focus:border-fx-coral"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-fx-line pt-3">
            <div className="flex items-center justify-between mb-2">
              <MicroLabel>Partner</MicroLabel>
              <span className="text-[11px] text-fx-mute truncate max-w-[160px]">{partnerLabel}</span>
            </div>
            <select
              value={filters.partnerId}
              onChange={(e) => onChange({ ...filters, partnerId: e.target.value })}
              className="w-full h-9 text-[13px] px-2 rounded-md border border-fx-line bg-card outline-none focus:border-fx-coral"
            >
              <option value="all">All Partners</option>
              <option value="__unassigned__">Unassigned Only</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {activeCount > 0 && (
            <button
              type="button"
              onClick={() => onChange(DEFAULT_BEACON_FILTERS)}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-fx-mute hover:text-text-primary"
            >
              <X className="h-3 w-3" />
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function getDateRangeForMode(filters: BeaconFilters): { fromIso: string; toIso: string } | null {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  switch (filters.dateMode) {
    case "today":
      return { fromIso: startOfToday.toISOString(), toIso: endOfToday.toISOString() };
    case "tomorrow": {
      const s = new Date(startOfToday);
      s.setDate(s.getDate() + 1);
      const e = new Date(endOfToday);
      e.setDate(e.getDate() + 1);
      return { fromIso: s.toISOString(), toIso: e.toISOString() };
    }
    case "week": {
      const day = startOfToday.getDay() || 7; // Mon=1..Sun=7
      const s = new Date(startOfToday);
      s.setDate(s.getDate() - (day - 1));
      const e = new Date(s);
      e.setDate(e.getDate() + 6);
      e.setHours(23, 59, 59, 999);
      return { fromIso: s.toISOString(), toIso: e.toISOString() };
    }
    case "month": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { fromIso: s.toISOString(), toIso: e.toISOString() };
    }
    case "qtd": {
      // Quarter-to-date: first day of current calendar quarter through end of today.
      const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
      const s = new Date(now.getFullYear(), qStartMonth, 1, 0, 0, 0, 0);
      return { fromIso: s.toISOString(), toIso: endOfToday.toISOString() };
    }
    case "custom": {
      if (!filters.customFrom || !filters.customTo) return null;
      const s = new Date(filters.customFrom + "T00:00:00");
      const e = new Date(filters.customTo + "T23:59:59.999");
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
      return { fromIso: s.toISOString(), toIso: e.toISOString() };
    }
    case "all":
    default:
      return null;
  }
}
