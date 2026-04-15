"use client";

import { CheckCircle2, Circle, Flag, Clock, PauseCircle, Pickaxe, Sparkles, Wallet, BanknoteArrowDown } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import type { PortalPhaseEvent } from "@/lib/server-fetchers/portal-job-detail";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface Stage {
  id: string;
  label: string;
  /** Status values that map into this stage for timeline progression. */
  statuses: string[];
  icon: IconComponent;
}

/** Six-step pipeline mirrors the internal dashboard (matches commit 4c5875e). */
const STAGES: Stage[] = [
  { id: "scheduled",  label: "Booking confirmed", statuses: ["unassigned", "auto_assigning", "scheduled", "late"], icon: Flag },
  { id: "phase1",     label: "Work started",      statuses: ["in_progress_phase1"],                                icon: Pickaxe },
  { id: "phase2",     label: "In progress",        statuses: ["in_progress_phase2", "in_progress_phase3"],          icon: Clock },
  { id: "final_check", label: "Final check",      statuses: ["final_check", "need_attention"],                     icon: Sparkles },
  { id: "payment",    label: "Payment",            statuses: ["awaiting_payment"],                                  icon: Wallet },
  { id: "completed",  label: "Completed",          statuses: ["completed"],                                          icon: CheckCircle2 },
];

const ON_HOLD_STATUS = "on_hold";
const CANCELLED_STATUS = "cancelled";

function currentStageIndex(status: string): number {
  if (status === ON_HOLD_STATUS || status === CANCELLED_STATUS) return -1;
  const idx = STAGES.findIndex((s) => s.statuses.includes(status));
  return idx;
}

function firstTimestampFor(stage: Stage, events: PortalPhaseEvent[]): string | null {
  const ev = events.find((e) => stage.statuses.includes(e.newStatus));
  return ev?.at ?? null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

interface JobPhaseTimelineProps {
  currentStatus: string;
  /** Audit log entries with newStatus transitions */
  events: PortalPhaseEvent[];
  /** When the job was created — used as the "booking confirmed" fallback. */
  createdAt: string;
}

export function JobPhaseTimeline({ currentStatus, events, createdAt }: JobPhaseTimelineProps) {
  const currentIdx = currentStageIndex(currentStatus);
  const isOnHold = currentStatus === ON_HOLD_STATUS;
  const isCancelled = currentStatus === CANCELLED_STATUS;

  return (
    <ol className="relative space-y-5 pl-6">
      <span
        aria-hidden
        className="absolute left-[11px] top-1 bottom-1 w-px bg-gradient-to-b from-orange-300 via-border to-border"
      />
      {STAGES.map((stage, i) => {
        const reached = currentIdx >= i;
        const isActive = currentIdx === i && !isOnHold && !isCancelled;
        const Icon = stage.icon;
        const ts = i === 0 ? (firstTimestampFor(stage, events) ?? createdAt) : firstTimestampFor(stage, events);

        return (
          <li key={stage.id} className="relative">
            <span
              className={[
                "absolute -left-6 top-0 h-5 w-5 rounded-full flex items-center justify-center border",
                reached
                  ? "bg-primary text-white border-primary"
                  : "bg-card text-text-tertiary border-border",
                isActive ? "ring-4 ring-primary/20" : "",
              ].join(" ")}
            >
              {reached ? <Icon className="w-3 h-3" /> : <Circle className="w-2.5 h-2.5" />}
            </span>
            <div className="pl-2">
              <p className={`text-sm font-semibold ${reached ? "text-text-primary" : "text-text-tertiary"}`}>
                {stage.label}
              </p>
              {ts ? (
                <p className="text-xs text-text-tertiary mt-0.5">{formatDate(ts)}</p>
              ) : (
                <p className="text-xs text-text-tertiary mt-0.5 italic">Upcoming</p>
              )}
              {isActive && (
                <span className="inline-flex items-center gap-1.5 mt-2 text-[11px] font-semibold text-primary">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
                  </span>
                  Happening now
                </span>
              )}
            </div>
          </li>
        );
      })}
      {isOnHold && (
        <li className="relative pl-2">
          <span className="absolute -left-6 top-0 h-5 w-5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center">
            <PauseCircle className="w-3 h-3" />
          </span>
          <p className="text-sm font-semibold text-amber-700">On hold</p>
          <p className="text-xs text-text-tertiary mt-0.5">We'll resume this job and update you shortly.</p>
        </li>
      )}
      {isCancelled && (
        <li className="relative pl-2">
          <span className="absolute -left-6 top-0 h-5 w-5 rounded-full bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center">
            <BanknoteArrowDown className="w-3 h-3" />
          </span>
          <p className="text-sm font-semibold text-rose-700">Cancelled</p>
        </li>
      )}
    </ol>
  );
}
