"use client";

import Link from "next/link";
import { List, LayoutGrid, Map as MapIcon, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { LiveIndicator, MicroLabel } from "@/components/fx/primitives";
import {
  BeaconFiltersButton,
  type BeaconFilters,
  type BeaconDateMode,
} from "@/components/beacon/beacon-filters";

export type BeaconView = "list" | "kanban" | "map";

const VIEWS: { id: BeaconView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "list", label: "List", icon: List },
  { id: "kanban", label: "Kanban", icon: LayoutGrid },
  { id: "map", label: "Map", icon: MapIcon },
];

const DATE_PRESETS: { id: BeaconDateMode; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "qtd", label: "QTD" },
];

type Props = {
  view: BeaconView;
  onViewChange: (v: BeaconView) => void;
  liveCount: number;
  filters: BeaconFilters;
  onFiltersChange: (next: BeaconFilters) => void;
};

export function BeaconHeader({ view, onViewChange, liveCount, filters, onFiltersChange }: Props) {
  return (
    <div className="flex items-end justify-between gap-6 flex-wrap">
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-3">
          <MicroLabel>Beacon</MicroLabel>
          <LiveIndicator label={`${liveCount} live`} />
        </div>
        <h1 className="text-[26px] font-semibold tracking-[-0.015em] leading-[1.2] text-text-primary m-0">
          Live Operations
        </h1>
        <p className="text-[13px] text-fx-mute m-0">
          Switch views to triage active work.
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex bg-fx-paper-2 rounded-md p-[3px] gap-0.5">
          {DATE_PRESETS.map((p) => {
            const active = filters.dateMode === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onFiltersChange({ ...filters, dateMode: p.id })}
                className={cn(
                  "inline-flex items-center px-3 py-[5px] rounded text-[12.5px] font-medium transition-colors",
                  active ? "bg-card text-text-primary shadow-fx-1" : "bg-transparent text-fx-mute hover:text-text-primary",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="inline-flex bg-fx-paper-2 rounded-md p-[3px] gap-0.5">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const active = v.id === view;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => onViewChange(v.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-[5px] rounded text-[12.5px] font-medium transition-colors",
                  active ? "bg-card text-text-primary shadow-fx-1" : "bg-transparent text-fx-mute hover:text-text-primary",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
              </button>
            );
          })}
        </div>
        <BeaconFiltersButton filters={filters} onChange={onFiltersChange} />
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1.5 px-3 py-[7px] rounded-md text-[13px] font-medium bg-fx-coral text-white hover:bg-fx-coral-h transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New Job
        </Link>
      </div>
    </div>
  );
}
