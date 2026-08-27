"use client";

import Link from "next/link";
import { formatBritishDate } from "@/lib/utils/date";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Clock, MapPin, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useBeaconJobsRealtime } from "@/hooks/use-beacon-jobs-realtime";
import { getSupabase } from "@/services/base";
import { updateJob } from "@/services/jobs";
import { FxAvatar, Pill } from "@/components/fx/primitives";
import { CancelJobModal } from "@/components/jobs/cancel-job-modal";
import { AssignPartnerModal } from "@/components/jobs/assign-partner-modal";
import { useFrontendSetup } from "@/hooks/use-frontend-setup";
import { marginColorClass, type MarginThresholds } from "@/lib/frontend-setup";
import type { JobStatus } from "@/types/database";
import { jobStatusLabel } from "@/lib/job-status-ui";
import {
  type BeaconFilters,
  DEFAULT_BEACON_FILTERS,
} from "@/components/beacon/beacon-filters";
import { fetchBeaconBoardJobs } from "@/lib/beacon-jobs";
import { effectiveJobStatusForDisplay } from "@/lib/job-partner-assign";
import { batchResolveClientAccountLogoUrls } from "@/lib/client-linked-account-label";
import { normalizeTypeOfWork } from "@/lib/type-of-work";
import { getJobScheduleTimingKind } from "@/components/shared/job-schedule-timing-chip";

type KanbanJob = {
  id: string;
  reference: string;
  title: string;
  status: JobStatus;
  client_id: string | null;
  partner_id: string | null;
  partner_ids: string[] | null;
  scheduled_date: string | null;
  client_name: string;
  property_address: string | null;
  partner_name: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  client_price: number;
  extras_amount: number | null;
  /** Drives the margin % chip on each card (gross margin on labour). */
  partner_cost: number | null;
  /** Shown in the card hover so the office can read the work without opening the job. */
  scope: string | null;
};

type StageId = "unassigned" | "scheduled" | "in_progress" | "final_checks" | "completed";

type Stage = {
  id: StageId;
  title: string;
  tone: "red" | "green" | "coral" | "violet" | "emerald";
  /** Statuses that visually belong to this column. */
  matches: (s: JobStatus) => boolean;
  /** Status to set on a job when it's dropped INTO this column. */
  dropStatus: JobStatus;
  /**
   * When set, a drop opens the matching modal in the job detail page
   * (preserves the existing approval / cancellation flows with all their
   * required side-effects, validations, and audit trail) instead of
   * updating the status directly.
   */
  dropAction?: "approve";
};

const STAGES: Stage[] = [
  {
    id: "unassigned",
    title: "Unassigned",
    tone: "red",
    matches: (s) => s === "unassigned" || s === "auto_assigning",
    dropStatus: "unassigned",
  },
  {
    id: "scheduled",
    title: "Scheduled",
    tone: "green",
    // `late` means scheduled but past arrival without starting — still pre-start,
    // belongs with Scheduled (red overdue chip is what flags the SLA breach).
    matches: (s) => s === "scheduled" || s === "late",
    dropStatus: "scheduled",
  },
  {
    id: "in_progress",
    title: "In Progress",
    tone: "coral",
    matches: (s) => s === "in_progress",
    dropStatus: "in_progress",
  },
  {
    id: "final_checks",
    title: "Final Checks",
    tone: "violet",
    matches: (s) => s === "final_check" || s === "need_attention",
    dropStatus: "final_check",
  },
  {
    id: "completed",
    title: "Completed",
    tone: "emerald",
    matches: (s) => s === "completed",
    dropStatus: "completed",
    dropAction: "approve",
  },
];

const STAGE_DOT: Record<Stage["tone"], string> = {
  red: "bg-fx-red",
  green: "bg-fx-green",
  coral: "bg-fx-coral",
  violet: "bg-[#7C3AED]",
  emerald: "bg-fx-green",
};

const COLLAPSE_STORAGE_KEY = "beacon_kanban_collapsed_v1";

export function BeaconKanban({ filters = DEFAULT_BEACON_FILTERS }: { filters?: BeaconFilters }) {
  const { marginThresholds } = useFrontendSetup();
  const [jobs, setJobs] = useState<KanbanJob[]>([]);
  const [loading, setLoading] = useState(true);
  /** partner_id → avatar_url. Loaded lazily once we know which partners appear in the visible cards. */
  const [partnerAvatars, setPartnerAvatars] = useState<Record<string, string | null>>({});
  /** clients.id → linked account logo_url (source_account). */
  const [accountLogoByClientId, setAccountLogoByClientId] = useState<Record<string, string | null>>({});
  /** Stage being hovered during a drag — drives the drop-target highlight. */
  const [dragOverStageId, setDragOverStageId] = useState<StageId | null>(null);
  /** Job ids currently mid-flight to the API; cards show a busy state while saving. */
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  /** Cancel modal target — when set, renders <CancelJobModal /> in-place. */
  const [cancelTarget, setCancelTarget] = useState<{ id: string; reference: string } | null>(null);
  /** Assign modal target — opened from the partner chip on an unassigned card. */
  const [assignTarget, setAssignTarget] = useState<{ id: string; reference: string } | null>(null);
  /** Stages the user has collapsed (persisted to localStorage). */
  const [collapsedStages, setCollapsedStages] = useState<Set<StageId>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw) as StageId[];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  });

  const toggleCollapse = useCallback((id: StageId) => {
    setCollapsedStages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* storage unavailable — collapse just won't persist */
      }
      return next;
    });
  }, []);

  const openCancelModal = useCallback((job: Pick<KanbanJob, "id" | "reference">) => {
    setCancelTarget({ id: job.id, reference: job.reference });
  }, []);

  const openAssignModal = useCallback((job: Pick<KanbanJob, "id" | "reference">) => {
    setAssignTarget({ id: job.id, reference: job.reference });
  }, []);

  const handleDropOnStage = async (stage: Stage, jobId: string) => {
    setDragOverStageId(null);
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    // No-op if dropped on its own column.
    if (stage.matches(effectiveJobStatusForDisplay(job))) return;

    // Approve navigates because FinalReviewModal pre-fetches invoice /
    // self-bill / reports, too heavy to mount here. Cancelling is the X on the
    // card, which opens the same modal the Jobs detail flow uses.
    if (stage.dropAction === "approve") {
      toast.message(`${job.reference} → review & approve`);
      window.location.assign(`/jobs/${jobId}?action=approve`);
      return;
    }

    const previousStatus = job.status;
    // Optimistic: update local state immediately so the card jumps columns.
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: stage.dropStatus } : j)));
    setPendingIds((prev) => new Set(prev).add(jobId));
    try {
      await updateJob(jobId, { status: stage.dropStatus });
      toast.success(`${job.reference} → ${stage.title}`);
    } catch (e) {
      // Rollback on error.
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: previousStatus } : j)));
      const msg = e instanceof Error ? e.message : "Failed to move job";
      toast.error(msg);
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  };

  /** Fetch jobs matching current filters. Memoized so the realtime subscription
   *  can call it on change without re-creating the channel each render. */
  const loadJobs = useCallback(
    async (signal?: { cancelled: boolean }) => {
      const baseCols =
        "id, reference, title, scope, status, partner_id, partner_ids, client_id, client_name, property_address, partner_name, scheduled_date, scheduled_start_at, scheduled_end_at, client_price, extras_amount, partner_cost";

      const load = async (cols: string) =>
        fetchBeaconBoardJobs(filters, cols, { includeCancelled: false });

      try {
        const rows = await load(baseCols);
        if (signal?.cancelled) return;
        setJobs(rows as unknown as KanbanJob[]);
      } catch (e) {
        const msg = e && typeof e === "object" && "message" in e ? String((e as { message: string }).message) : "";
        const isMissingColumn =
          (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "42703") ||
          /partner_ids/i.test(msg);
        if (!isMissingColumn) {
          if (!signal?.cancelled) setJobs([]);
          return;
        }
        try {
          const slimCols =
            "id, reference, title, scope, status, partner_id, client_id, client_name, property_address, partner_name, scheduled_date, scheduled_start_at, scheduled_end_at, client_price, extras_amount, partner_cost";
          const rows = await load(slimCols);
          if (signal?.cancelled) return;
          setJobs(rows as unknown as KanbanJob[]);
        } catch {
          if (!signal?.cancelled) setJobs([]);
        }
      }
    },
    [filters],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    queueMicrotask(() => {
      if (!signal.cancelled) setLoading(true);
    });
    void loadJobs(signal).finally(() => {
      if (!signal.cancelled) setLoading(false);
    });
    return () => {
      signal.cancelled = true;
    };
  }, [loadJobs]);

  // Lazy-load partner avatar URLs for the partner_ids currently on screen.
  // Only fetches partners we don't already have cached, so re-renders are cheap.
  useEffect(() => {
    const supabase = getSupabase();
    const unknownIds = Array.from(
      new Set(
        jobs
          .map((j) => j.partner_id)
          .filter((id): id is string => !!id && !(id in partnerAvatars)),
      ),
    );
    if (unknownIds.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.from("partners").select("id, avatar_url").in("id", unknownIds);
      if (cancelled) return;
      setPartnerAvatars((prev) => {
        const next = { ...prev };
        for (const id of unknownIds) next[id] = null; // mark as fetched (so we don't retry on next render)
        for (const row of (data ?? []) as { id: string; avatar_url: string | null }[]) {
          next[row.id] = row.avatar_url?.trim() || null;
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [jobs, partnerAvatars]);

  useEffect(() => {
    const clientIds = [...new Set(jobs.map((j) => j.client_id).filter(Boolean))] as string[];
    if (clientIds.length === 0) {
      setAccountLogoByClientId({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const supabase = getSupabase();
      const map = await batchResolveClientAccountLogoUrls(supabase, clientIds);
      if (cancelled) return;
      const next: Record<string, string | null> = {};
      for (const id of clientIds) next[id] = map.get(id) ?? null;
      setAccountLogoByClientId(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [jobs]);

  useBeaconJobsRealtime(() => {
    void loadJobs();
  }, "beacon_kanban_jobs");

  const grouped = useMemo(() => {
    const out = new Map<StageId, { items: KanbanJob[]; revenue: number }>(
      STAGES.map((s) => [s.id, { items: [], revenue: 0 }]),
    );
    for (const j of jobs) {
      const stage = STAGES.find((s) => s.matches(effectiveJobStatusForDisplay(j)));
      if (!stage) continue;
      const bucket = out.get(stage.id)!;
      bucket.items.push(j);
      bucket.revenue += (Number(j.client_price) || 0) + (Number(j.extras_amount) || 0);
    }
    return out;
  }, [jobs]);

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 gap-3">
        {STAGES.map((s) => (
          <div key={s.id} className="flex-1 rounded-xl bg-fx-paper-2/40 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto pb-1 lg:overflow-x-visible">
        {STAGES.map((stage) => {
          const bucket = grouped.get(stage.id) ?? { items: [], revenue: 0 };
          const items = bucket.items;
          const stageRevenue = bucket.revenue;
          const isDragTarget = dragOverStageId === stage.id;
          const isCollapsed = collapsedStages.has(stage.id);
          // Cancel button on cards is hidden for Completed (terminal stage).
          const showCardCancelButton = !stage.dropAction;
          return (
            <div
              key={stage.id}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("text/job-id")) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragOverStageId !== stage.id) setDragOverStageId(stage.id);
                // Auto-expand a collapsed column when something is dragged onto it
                // so the user gets visual confirmation the drop will land here.
                if (collapsedStages.has(stage.id)) {
                  setCollapsedStages((prev) => {
                    const next = new Set(prev);
                    next.delete(stage.id);
                    try {
                      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...next]));
                    } catch {
                      /* non-blocking */
                    }
                    return next;
                  });
                }
              }}
              onDragLeave={(e) => {
                // Only clear when leaving the column wrapper itself, not children.
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                setDragOverStageId((cur) => (cur === stage.id ? null : cur));
              }}
              onDrop={(e) => {
                e.preventDefault();
                const jobId = e.dataTransfer.getData("text/job-id");
                if (jobId) void handleDropOnStage(stage, jobId);
              }}
              className={cn(
                "flex min-h-0 flex-col gap-2.5 rounded-xl bg-fx-paper-2 transition-colors",
                // Below lg the board scrolls sideways with fixed-width columns.
                // From lg up the columns split the width evenly, so the board
                // itself never scrolls: each column scrolls its own cards.
                "w-[264px] shrink-0 lg:w-auto lg:min-w-0 lg:flex-1",
                isCollapsed ? "p-2" : "p-3",
                isDragTarget && "ring-2 ring-fx-coral/50 bg-fx-coral/5",
              )}
            >
              <button
                type="button"
                onClick={() => toggleCollapse(stage.id)}
                title={isCollapsed ? `Expand ${stage.title}` : `Collapse ${stage.title}`}
                className={cn(
                  "flex shrink-0 items-center justify-between gap-1.5 px-0.5 pb-1 w-full text-left rounded-md hover:bg-card/40 transition-colors",
                  isCollapsed && "pb-0",
                )}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {isCollapsed ? (
                    <ChevronRight className="h-3 w-3 shrink-0 text-fx-mute" />
                  ) : (
                    <ChevronDown className="h-3 w-3 shrink-0 text-fx-mute" />
                  )}
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", STAGE_DOT[stage.tone])} />
                  <span className="text-[12px] font-semibold text-text-primary truncate">{stage.title}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="font-mono text-[10px] text-fx-mute bg-card border border-fx-line rounded-sm px-1 py-0.5">
                    {items.length}
                  </span>
                  {stageRevenue > 0 && (
                    <span
                      className="font-mono text-[10px] text-text-primary bg-card border border-fx-line rounded-sm px-1 py-0.5 tabular-nums"
                      title="Total revenue in this stage"
                    >
                      {formatGbp(stageRevenue)}
                    </span>
                  )}
                </div>
              </button>
              {!isCollapsed && (
                <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain pr-0.5">
                  {items.length === 0 ? (
                    <div className="text-center py-6 text-[12px] text-fx-mute">
                      {isDragTarget ? "Drop here" : `No jobs in ${stage.title.toLowerCase()}.`}
                    </div>
                  ) : (
                    items.map((j) => (
                      <KanbanCard
                        key={j.id}
                        job={j}
                        pending={pendingIds.has(j.id)}
                        showCancelButton={showCardCancelButton}
                        onCancelClick={openCancelModal}
                        onAssignClick={stage.id === "unassigned" ? openAssignModal : undefined}
                        partnerAvatarUrl={j.partner_id ? partnerAvatars[j.partner_id] ?? null : null}
                        accountLogoUrl={
                          j.client_id
                            ? accountLogoByClientId[j.client_id]?.trim() || null
                            : null
                        }
                        marginThresholds={marginThresholds}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {assignTarget && (
        <AssignPartnerModal
          jobId={assignTarget.id}
          jobReference={assignTarget.reference}
          isOpen={assignTarget !== null}
          onClose={() => setAssignTarget(null)}
          onAssigned={() => {
            setAssignTarget(null);
            void loadJobs();
          }}
        />
      )}
      {cancelTarget && (
        <CancelJobModal
          jobId={cancelTarget.id}
          jobReference={cancelTarget.reference}
          isOpen={cancelTarget !== null}
          onClose={() => setCancelTarget(null)}
          onCancelled={() => {
            // Realtime channel will refetch the row; nothing else needed here.
            setCancelTarget(null);
          }}
        />
      )}
    </>
  );
}

function KanbanCard({
  job,
  pending = false,
  showCancelButton = false,
  onCancelClick,
  onAssignClick,
  partnerAvatarUrl,
  accountLogoUrl,
  marginThresholds,
}: {
  job: KanbanJob;
  pending?: boolean;
  showCancelButton?: boolean;
  onCancelClick?: (job: Pick<KanbanJob, "id" | "reference">) => void;
  /** Set on the Unassigned column: turns the partner chip into "assign a partner". */
  onAssignClick?: (job: Pick<KanbanJob, "id" | "reference">) => void;
  partnerAvatarUrl?: string | null;
  accountLogoUrl?: string | null;
  marginThresholds: MarginThresholds;
}) {
  const typeOfWorkLabel = normalizeTypeOfWork(job.title) || job.title;
  const [nowMs] = useState(() => Date.now());
  /** Anchor rect of the hovered card — drives the detail panel next to it. */
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  // "Live" = work actually started. `late` here means "scheduled but past
  // arrival time, partner hasn't started yet" — that's NOT live, it's overdue.
  // Only `in_progress` zeroes the arrival SLA.
  const isLive = job.status === "in_progress";
  const value = Number(job.client_price) + (Number(job.extras_amount) || 0);
  const partnerInitials = job.partner_name ? initials(job.partner_name) : "?";
  /** Gross margin: (price − partner cost) / price. Hidden when price is 0 or
   * we don't have a partner cost yet (avoids 100% / NaN noise on draft rows).
   * Colour comes from the configured thresholds (Settings → Setup → Margin Targets). */
  const partnerCost = Number(job.partner_cost) || 0;
  const marginPct = value > 0 && partnerCost > 0
    ? Math.round(((value - partnerCost) / value) * 100)
    : null;
  const marginTone = marginPct == null ? "" : marginColorClass(marginPct, marginThresholds);
  // Arrival overdue: end of arrival window has passed AND the job hasn't started
  // yet. `in_progress` (and beyond) clears the SLA — work began, so the arrival
  // window is no longer the relevant clock.
  const arrivalEndMs = job.scheduled_end_at ? new Date(job.scheduled_end_at).getTime() : NaN;
  const isOverdueArrival =
    !Number.isNaN(arrivalEndMs) &&
    arrivalEndMs < nowMs &&
    (() => {
      const st = effectiveJobStatusForDisplay(job);
      return st === "unassigned" || st === "auto_assigning" || st === "scheduled" || st === "late";
    })();

  return (
    <Link
      href={`/jobs/${job.id}`}
      target="_blank"
      rel="noopener noreferrer"
      draggable={!pending}
      onMouseEnter={(e) => setHoverRect(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setHoverRect(null)}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/job-id", job.id);
        setHoverRect(null);
      }}
      onClick={(e) => {
        // Block navigation while a status update is mid-flight to avoid a
        // confusing route change before the drop confirms.
        if (pending) e.preventDefault();
      }}
      className={cn(
        "group relative block bg-card border rounded-lg p-3 hover:shadow-fx-2 transition-shadow",
        isLive ? "border-fx-coral/40 shadow-[0_0_0_2px_rgba(237,75,0,0.06)]" : "border-fx-line hover:border-fx-line-2",
        pending ? "opacity-60 pointer-events-none" : "cursor-grab active:cursor-grabbing",
      )}
    >
      {showCancelButton && onCancelClick && !pending && (
        <button
          type="button"
          aria-label="Cancel job"
          title="Cancel job"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onCancelClick({ id: job.id, reference: job.reference });
          }}
          className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-fx-red/10 text-fx-red opacity-0 transition-opacity hover:bg-fx-red/20 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-fx-red/30"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="font-mono text-[10.5px] text-fx-mute tracking-[0.04em] truncate">{job.reference}</span>
        <StatusPill status={job.status} job={job} />
      </div>
      <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
        <div className="flex items-center gap-1 min-w-0 flex-1 text-[13px] font-medium text-text-primary leading-[1.3]">
          {accountLogoUrl ? (
            <>
              <img
                src={accountLogoUrl}
                alt=""
                className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 rounded-[3px] object-contain bg-white ring-1 ring-black/[0.08] dark:ring-white/10"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
              <span className="text-fx-mute shrink-0 font-normal" aria-hidden>
                -
              </span>
            </>
          ) : null}
          <span className="truncate min-w-0" title={typeOfWorkLabel}>
            {typeOfWorkLabel}
          </span>
        </div>
        {formatArrivalWindow(job.scheduled_start_at, job.scheduled_end_at) ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 font-mono text-[10.5px] tabular-nums shrink-0",
              isOverdueArrival
                ? "text-fx-red font-semibold"
                : isLive
                  ? "text-fx-coral-p"
                  : "text-text-secondary",
            )}
            title={isOverdueArrival ? "Arrival window passed — job hasn't started" : "Arrival window"}
          >
            <Clock className="h-2.5 w-2.5 shrink-0" />
            {formatArrivalWindow(job.scheduled_start_at, job.scheduled_end_at)}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-fx-mute font-mono mb-2">
        <MapPin className="h-2.5 w-2.5 shrink-0" />
        <span className="truncate">
          {[
            extractPostcode(job.property_address),
            shortAddress(job.property_address),
            job.client_name,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-dashed border-fx-line">
        {onAssignClick && !pending ? (
          <button
            type="button"
            title="Assign a partner"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onAssignClick({ id: job.id, reference: job.reference });
            }}
            className="-ml-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-fx-coral/10"
          >
            <FxAvatar
              initials={partnerInitials}
              tone={job.partner_name ? "coral" : "neutral"}
              size="sm"
              src={partnerAvatarUrl}
              alt={job.partner_name ?? undefined}
            />
            <span className={cn("fx-kk truncate", !job.partner_name && "italic")}>
              {job.partner_name || "Assign partner"}
            </span>
          </button>
        ) : (
          <div className="flex items-center gap-1.5 min-w-0">
            <FxAvatar
              initials={partnerInitials}
              tone={job.partner_name ? "coral" : "neutral"}
              size="sm"
              src={partnerAvatarUrl}
              alt={job.partner_name ?? undefined}
            />
            <span className={cn("fx-kk truncate", !job.partner_name && "italic")}>
              {job.partner_name || "Unassigned"}
            </span>
          </div>
        )}
        <div className="flex items-baseline gap-1.5 shrink-0">
          <span className="font-medium text-fx-coral-p text-[13px] tabular-nums">
            {formatGbp(value)}
          </span>
          {marginPct != null ? (
            <span
              className={cn("font-mono text-[10.5px] tabular-nums", marginTone)}
              title={`Gross margin · target ≥${marginThresholds.targetPct}% · low <${marginThresholds.lowPct}%`}
            >
              {marginPct}%
            </span>
          ) : null}
        </div>
      </div>
      {hoverRect ? <JobHoverPanel job={job} anchor={hoverRect} /> : null}
    </Link>
  );
}

/**
 * Hover detail next to the card: full address and scope of work, so the office
 * can read a job without leaving the board. Rendered in a portal because the
 * column clips its own overflow, and `pointer-events-none` so it can never
 * steal the hover that spawned it.
 */
function JobHoverPanel({ job, anchor }: { job: KanbanJob; anchor: DOMRect }) {
  if (typeof document === "undefined") return null;

  const WIDTH = 320;
  const GAP = 10;
  const spillsRight = anchor.right + GAP + WIDTH > window.innerWidth;
  const left = spillsRight ? Math.max(8, anchor.left - GAP - WIDTH) : anchor.right + GAP;
  const top = Math.min(Math.max(8, anchor.top), Math.max(8, window.innerHeight - 300));

  const scope = (job.scope ?? "").trim();
  const address = (job.property_address ?? "").trim();
  const window_ = formatArrivalWindow(job.scheduled_start_at, job.scheduled_end_at);
  const day = job.scheduled_date
    ? formatBritishDate(new Date(`${job.scheduled_date}T12:00:00`))
    : "";

  return createPortal(
    <div
      style={{ left, top, width: WIDTH }}
      className="pointer-events-none fixed z-[70] rounded-xl border border-fx-line bg-card p-3 shadow-fx-2"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[10.5px] tracking-[0.04em] text-fx-mute">{job.reference}</span>
        <StatusPill status={job.status} job={job} />
      </div>
      <p className="mb-2 text-[13px] font-semibold leading-tight text-text-primary">{normalizeTypeOfWork(job.title) || job.title}</p>
      <dl className="space-y-1.5 text-[11.5px] leading-snug">
        <HoverRow label="Client" value={job.client_name} />
        <HoverRow label="Address" value={address || "—"} />
        <HoverRow label="When" value={[day, window_].filter(Boolean).join(" · ") || "Not scheduled"} />
        <HoverRow label="Partner" value={job.partner_name || "Unassigned"} />
      </dl>
      <div className="mt-2 border-t border-dashed border-fx-line pt-2">
        <p className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-fx-mute">Scope of work</p>
        <p className="max-h-[168px] overflow-hidden whitespace-pre-wrap text-[11.5px] leading-snug text-text-secondary">
          {scope || "No scope recorded on this job."}
        </p>
      </div>
    </div>,
    document.body,
  );
}

function HoverRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-[52px] shrink-0 font-mono text-[9.5px] uppercase tracking-[0.14em] text-fx-mute">{label}</dt>
      <dd className="min-w-0 flex-1 text-text-primary">{value}</dd>
    </div>
  );
}

const SOON_LABEL = { today: "Today", tomorrow: "Tomorrow", in_2_days: "In 2 days" } as const;

/** Unassigned + visit is imminent: the pill says when, not what. A card reading
 *  "TOMORROW" is the one the office has to act on today. */
function StatusPill({ status, job }: { status: JobStatus; job?: KanbanJob }) {
  const timing = job ? getJobScheduleTimingKind(job) : null;
  const isUnassigned = status === "unassigned" || status === "auto_assigning";
  const label = isUnassigned && timing ? SOON_LABEL[timing] : jobStatusLabel(status);
  switch (status) {
    case "unassigned":
      return <Pill tone="bad">{label}</Pill>;
    case "auto_assigning":
      return <Pill tone="info">{label}</Pill>;
    case "scheduled":
      return <Pill tone="ok">{label}</Pill>;
    case "in_progress":
      return <Pill tone="info">{label}</Pill>;
    case "late":
      return <Pill tone="coral">{label}</Pill>;
    case "final_check":
      return <Pill tone="violet">{label}</Pill>;
    case "awaiting_payment":
      return <Pill tone="warn">{label}</Pill>;
    case "need_attention":
      return <Pill tone="bad">{label}</Pill>;
    case "on_hold":
      return <Pill tone="warn">{label}</Pill>;
    case "completed":
      return <Pill tone="ok">{label}</Pill>;
    case "cancelled":
      return <Pill tone="bad">{label}</Pill>;
    default:
      return <Pill tone="ghost">{label}</Pill>;
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function shortAddress(addr: string | null): string {
  if (!addr) return "";
  return addr.split(",").slice(0, 1).join(",").trim();
}

/** Compact "09:00–12:00" arrival window for the card, rendered in UK time
 *  (Europe/London — handles GMT/BST automatically) so it matches the job
 *  detail page and the partner app regardless of the viewer's browser TZ. */
const UK_HHMM = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatArrivalWindow(startIso: string | null, endIso: string | null): string {
  const fmt = (iso: string | null): string => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return UK_HHMM.format(d);
  };
  const a = fmt(startIso);
  const b = fmt(endIso);
  if (!a && !b) return "";
  if (a && b && a !== b) return `${a}–${b}`;
  return a || b;
}

/**
 * Extract a UK postcode from a free-form address string.
 * Matches standard formats (SW1A 1AA, EC1A 1BB, M1 1AA, TW3 6QH, etc).
 * Returns the postcode in canonical uppercase form, or empty string when none found.
 */
function extractPostcode(addr: string | null): string {
  if (!addr) return "";
  const match = addr.match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i);
  if (!match) return "";
  return `${match[1].toUpperCase()} ${match[2].toUpperCase()}`;
}

function formatGbp(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}
