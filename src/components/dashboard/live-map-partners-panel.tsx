"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { ScheduleLiveMapPoint } from "@/components/dashboard/schedule-live-map";
import {
  LIVE_MAP_PARTNER_STATUS_COLOR,
  LIVE_MAP_PARTNER_STATUS_DESCRIPTION,
  LIVE_MAP_PARTNER_STATUS_LABEL,
  LIVE_MAP_PARTNER_STATUS_ORDER,
  type LiveMapPartnerStatus,
} from "@/lib/live-map-partner-status";

interface LiveMapPartnersPanelProps {
  /** All visible partners (trade-filtered, status-tagged) — the panel groups them itself. */
  points: ScheduleLiveMapPoint[];
  /** When set, only this status is scoping the map. */
  selectedStatus: LiveMapPartnerStatus | null;
  onStatusToggle: (status: LiveMapPartnerStatus) => void;
  /** Click a partner row → page draws route + centers map. */
  onPartnerClick: (partnerId: string) => void;
  lastUpdatedAt?: string | null;
}

const PANEL_LIST_LIMIT = 6;

export function LiveMapPartnersPanel({
  points,
  selectedStatus,
  onStatusToggle,
  onPartnerClick,
  lastUpdatedAt,
}: LiveMapPartnersPanelProps) {
  const grouped = useMemo(() => {
    const map = new Map<LiveMapPartnerStatus, ScheduleLiveMapPoint[]>();
    for (const status of LIVE_MAP_PARTNER_STATUS_ORDER) {
      map.set(status, []);
    }
    for (const p of points) {
      map.get(p.status)?.push(p);
    }
    return map;
  }, [points]);

  const totalActive = points.length - (grouped.get("offline")?.length ?? 0);
  const listForSelected = selectedStatus ? grouped.get(selectedStatus) ?? [] : [];

  return (
    <div className="w-[260px] max-w-[92vw] rounded-xl border border-border bg-card/95 px-3 py-2.5 shadow-md backdrop-blur-sm dark:border-border dark:bg-card/95">
      <div className="flex items-center justify-between gap-2 pb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#020040]">
          Partners
        </span>
        <span className="text-[10px] text-[#64748B]">
          {totalActive} live
          {lastUpdatedAt ? ` · ${new Date(lastUpdatedAt).toLocaleTimeString()}` : ""}
        </span>
      </div>

      <div className="flex flex-col gap-0.5">
        {LIVE_MAP_PARTNER_STATUS_ORDER.map((status) => {
          const list = grouped.get(status) ?? [];
          const active = selectedStatus === status;
          const empty = list.length === 0;
          return (
            <button
              key={status}
              type="button"
              onClick={() => onStatusToggle(status)}
              aria-pressed={active}
              disabled={empty && !active}
              title={LIVE_MAP_PARTNER_STATUS_DESCRIPTION[status]}
              className={cn(
                "flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-[11.5px] transition-colors",
                active
                  ? "bg-[#020040]/5 text-[#020040]"
                  : empty
                    ? "cursor-default text-[#94A3B8]"
                    : "text-[#020040] hover:bg-[#FAFAFB]",
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    empty && !active ? "opacity-40" : "",
                  )}
                  style={{ background: LIVE_MAP_PARTNER_STATUS_COLOR[status] }}
                  aria-hidden
                />
                <span className="font-medium">{LIVE_MAP_PARTNER_STATUS_LABEL[status]}</span>
              </span>
              <span className="font-mono text-[11px] font-semibold tabular-nums">{list.length}</span>
            </button>
          );
        })}
      </div>

      {selectedStatus && listForSelected.length > 0 ? (
        <div className="mt-2 border-t border-[#E4E4E8] pt-1.5">
          <ul className="flex flex-col gap-0.5">
            {listForSelected.slice(0, PANEL_LIST_LIMIT).map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPartnerClick(p.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-[11px] text-[#020040] hover:bg-[#FAFAFB]"
                >
                  <span className="truncate font-medium">{p.name}</span>
                  {typeof p.jobsInWindow === "number" && p.jobsInWindow > 0 ? (
                    <span className="text-[10px] text-[#64748B]">
                      {p.jobsInWindow} job{p.jobsInWindow === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          {listForSelected.length > PANEL_LIST_LIMIT ? (
            <p className="px-1.5 pt-1 text-[10px] text-[#64748B]">
              +{listForSelected.length - PANEL_LIST_LIMIT} more
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
