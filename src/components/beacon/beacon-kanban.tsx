"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, MapPin, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { updateJob } from "@/services/jobs";
import { FxAvatar, Pill } from "@/components/fx/primitives";
import { CancelJobModal } from "@/components/jobs/cancel-job-modal";
import type { JobStatus } from "@/types/database";
import { jobStatusLabel } from "@/lib/job-status-ui";
import {
  type BeaconFilters,
  DEFAULT_BEACON_FILTERS,
  getDateRangeForMode,
} from "@/components/beacon/beacon-filters";

type KanbanJob = {
  id: string;
  reference: string;
  title: string;
  status: JobStatus;
  client_name: string;
  property_address: string | null;
  partner_name: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  client_price: number;
  extras_amount: number | null;
  /** Snapshot fields populated when a cancel happens — used to show "lost revenue" on cards already in the Cancelled column. */
  cancelled_client_price: number | null;
  cancelled_extras_amount: number | null;
};

type StageId = "unassigned" | "scheduled" | "in_progress" | "final_checks" | "completed" | "cancelled";

type Stage = {
  id: StageId;
  title: string;
  tone: "red" | "green" | "coral" | "violet" | "emerald" | "danger";
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
  dropAction?: "approve" | "cancel";
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
    matches: (s) => s === "scheduled",
    dropStatus: "scheduled",
  },
  {
    id: "in_progress",
    title: "In Progress",
    tone: "coral",
    matches: (s) => s === "in_progress" || s === "late",
    dropStatus: "in_progress",
  },
  {
    id: "final_checks",
    title: "Final Checks",
    tone: "violet",
    matches: (s) => s === "final_check" || s === "awaiting_payment" || s === "need_attention" || s === "on_hold",
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
  {
    id: "cancelled",
    title: "Cancelled",
    tone: "danger",
    matches: (s) => s === "cancelled",
    dropStatus: "cancelled",
    dropAction: "cancel",
  },
];

const STAGE_DOT: Record<Stage["tone"], string> = {
  red: "bg-fx-red",
  green: "bg-fx-green",
  coral: "bg-fx-coral",
  violet: "bg-[#7C3AED]",
  emerald: "bg-fx-green",
  danger: "bg-fx-red",
};

const COLLAPSE_STORAGE_KEY = "beacon_kanban_collapsed_v1";

export function BeaconKanban({ filters = DEFAULT_BEACON_FILTERS }: { filters?: BeaconFilters }) {
  const [jobs, setJobs] = useState<KanbanJob[]>([]);
  const [loading, setLoading] = useState(true);
  /** Stage being hovered during a drag — drives the drop-target highlight. */
  const [dragOverStageId, setDragOverStageId] = useState<StageId | null>(null);
  /** Job ids currently mid-flight to the API; cards show a busy state while saving. */
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  /** Cancel modal target — when set, renders <CancelJobModal /> in-place. */
  const [cancelTarget, setCancelTarget] = useState<{ id: string; reference: string } | null>(null);
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

  const handleDropOnStage = async (stage: Stage, jobId: string) => {
    setDragOverStageId(null);
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    // No-op if dropped on its own column.
    if (stage.matches(job.status)) return;

    // Cancel: open the in-place modal with the same validation + side effects
    // as the Jobs detail flow. Approve still navigates because FinalReviewModal
    // pre-fetches invoice/self-bill/reports/etc. that are too heavy to mount here.
    if (stage.dropAction === "cancel") {
      openCancelModal(job);
      return;
    }
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
      const supabase = getSupabase();
      // Cancelled stays visible in the Kanban so the user can see today's
      // cancellations + can drag a job into the Cancelled column. `deleted` is
      // still hidden (soft-deleted, out of the workflow).
      const baseCols =
        "id, reference, title, status, partner_id, client_name, property_address, partner_name, scheduled_start_at, scheduled_end_at, client_price, extras_amount";
      const snapshotCols = "cancelled_client_price, cancelled_extras_amount";

      const buildQuery = (cols: string) => {
        let q = supabase
          .from("jobs")
          .select(cols)
          .neq("status", "deleted")
          .is("deleted_at", null);
        const range = getDateRangeForMode(filters);
        if (range) {
          q = q.gte("scheduled_start_at", range.fromIso).lte("scheduled_start_at", range.toIso);
        }
        if (filters.partnerId === "__unassigned__") {
          q = q.is("partner_id", null);
        } else if (filters.partnerId !== "all") {
          q = q.eq("partner_id", filters.partnerId);
        }
        return q.order("scheduled_start_at", { ascending: true }).limit(200);
      };

      // Try with snapshot columns first (post-migration). If the DB hasn't
      // been migrated yet, Postgres returns 42703 — fall back to the legacy
      // shape so the Kanban keeps working until the migration runs.
      let { data, error } = await buildQuery(`${baseCols}, ${snapshotCols}`);
      if (error) {
        const msg = error.message ?? "";
        const isMissingColumn =
          error.code === "42703" ||
          /cancelled_client_price|cancelled_extras_amount/i.test(msg);
        if (isMissingColumn) {
          ({ data, error } = await buildQuery(baseCols));
        }
      }
      if (signal?.cancelled) return;
      if (error) {
        setJobs([]);
        return;
      }
      setJobs((data ?? []) as unknown as KanbanJob[]);
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

  /**
   * Realtime: subscribe to changes on the `jobs` table and refetch on any
   * INSERT / UPDATE / DELETE. RLS still applies on the WAL stream — users only
   * get events for rows they're allowed to read. Debounced 300ms to avoid
   * spamming refetches when several rows change at once (e.g. bulk updates).
   */
  useEffect(() => {
    const supabase = getSupabase();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void loadJobs();
      }, 300);
    };
    const channel = supabase
      .channel("beacon_kanban_jobs")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, schedule)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [loadJobs]);

  const grouped = useMemo(() => {
    const out = new Map<StageId, { items: KanbanJob[]; revenue: number; lostRevenue: number }>(
      STAGES.map((s) => [s.id, { items: [], revenue: 0, lostRevenue: 0 }]),
    );
    for (const j of jobs) {
      const stage = STAGES.find((s) => s.matches(j.status));
      if (!stage) continue;
      const bucket = out.get(stage.id)!;
      bucket.items.push(j);
      if (stage.id === "cancelled") {
        // Cancel zeroes live financials — pull the snapshot fields for "lost revenue".
        bucket.lostRevenue +=
          (Number(j.cancelled_client_price) || 0) + (Number(j.cancelled_extras_amount) || 0);
      } else {
        bucket.revenue += (Number(j.client_price) || 0) + (Number(j.extras_amount) || 0);
      }
    }
    return out;
  }, [jobs]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {STAGES.map((s) => (
          <div key={s.id} className="rounded-xl bg-fx-paper-2/40 h-64 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 pb-2 items-start">
        {STAGES.map((stage) => {
          const bucket = grouped.get(stage.id) ?? { items: [], revenue: 0, lostRevenue: 0 };
          const items = bucket.items;
          const stageRevenue = bucket.revenue;
          const stageLostRevenue = bucket.lostRevenue;
          const isDragTarget = dragOverStageId === stage.id;
          const isCollapsed = collapsedStages.has(stage.id);
          const isCancelStage = stage.id === "cancelled";
          // Cancel button on cards is hidden for completed/cancelled (terminal) stages.
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
                "flex flex-col gap-2.5 min-w-0 rounded-xl bg-fx-paper-2 transition-colors",
                isCollapsed ? "p-2" : "p-3",
                isDragTarget && "ring-2 ring-fx-coral/50 bg-fx-coral/5",
              )}
            >
              <button
                type="button"
                onClick={() => toggleCollapse(stage.id)}
                title={isCollapsed ? `Expand ${stage.title}` : `Collapse ${stage.title}`}
                className={cn(
                  "flex items-center justify-between gap-1.5 px-0.5 pb-1 w-full text-left rounded-md hover:bg-card/40 transition-colors",
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
                  {isCancelStage && stageLostRevenue > 0 && (
                    <span
                      className="font-mono text-[10px] text-fx-red bg-fx-red/10 border border-fx-red/20 rounded-sm px-1 py-0.5 tabular-nums"
                      title="Lost revenue (sum of cancelled jobs)"
                    >
                      {formatGbp(stageLostRevenue)}
                    </span>
                  )}
                  {!isCancelStage && stageRevenue > 0 && (
                    <span
                      className="font-mono text-[10px] text-text-primary bg-card border border-fx-line rounded-sm px-1 py-0.5 tabular-nums"
                      title="Total revenue in this stage"
                    >
                      {formatGbp(stageRevenue)}
                    </span>
                  )}
                </div>
              </button>
              {!isCollapsed &&
                (items.length === 0 ? (
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
                      isCancelledStage={isCancelStage}
                    />
                  ))
                ))}
            </div>
          );
        })}
      </div>
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
  isCancelledStage = false,
}: {
  job: KanbanJob;
  pending?: boolean;
  showCancelButton?: boolean;
  onCancelClick?: (job: Pick<KanbanJob, "id" | "reference">) => void;
  isCancelledStage?: boolean;
}) {
  const isLive = job.status === "in_progress" || job.status === "late";
  const lostValue =
    (Number(job.cancelled_client_price) || 0) + (Number(job.cancelled_extras_amount) || 0);
  const liveValue = Number(job.client_price) + (Number(job.extras_amount) || 0);
  const value = isCancelledStage ? lostValue : liveValue;
  const partnerInitials = job.partner_name ? initials(job.partner_name) : "?";

  return (
    <Link
      href={`/jobs/${job.id}`}
      draggable={!pending}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/job-id", job.id);
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
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="font-mono text-[10.5px] text-fx-mute tracking-[0.04em] truncate">{job.reference}</span>
        <StatusPill status={job.status} />
      </div>
      <div className="text-[13px] font-medium text-text-primary leading-[1.35] mb-1.5 line-clamp-2">
        {job.title}
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
      <div className="flex items-center justify-between gap-1.5 mt-2 pt-2 border-t border-dashed border-fx-line">
        <div className="flex items-center gap-1.5 min-w-0">
          <FxAvatar
            initials={partnerInitials}
            tone={job.partner_name ? "coral" : "neutral"}
            size="sm"
          />
          <span className={cn("fx-kk truncate", !job.partner_name && "italic")}>
            {job.partner_name || "Unassigned"}
          </span>
        </div>
        {isCancelledStage ? (
          <span
            className="font-medium text-fx-red text-[13px] tabular-nums shrink-0"
            title="Lost revenue at cancel"
          >
            {value > 0 ? `Lost ${formatGbp(value)}` : "Lost £0"}
          </span>
        ) : (
          <span className="font-medium text-fx-coral-p text-[13px] tabular-nums shrink-0">
            {formatGbp(value)}
          </span>
        )}
      </div>
    </Link>
  );
}

function StatusPill({ status }: { status: JobStatus }) {
  const label = jobStatusLabel(status);
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
