"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import { FxAvatar, MicroLabel, Pill } from "@/components/fx/primitives";
import type { JobStatus } from "@/types/database";
import { jobStatusLabel } from "@/lib/job-status-ui";
import {
  type BeaconFilters,
  DEFAULT_BEACON_FILTERS,
  getDateRangeForMode,
} from "@/components/beacon/beacon-filters";

type ListJob = {
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
};

type GroupId = "live" | "scheduled" | "wrap" | "new" | "done";

type Group = {
  id: GroupId;
  title: string;
  color: string;
  matches: (s: JobStatus) => boolean;
};

const GROUPS: Group[] = [
  { id: "live", title: "In Progress · Happening Now", color: "var(--color-fx-coral)", matches: (s) => s === "in_progress" || s === "late" },
  { id: "scheduled", title: "Scheduled · Today / Soon", color: "var(--color-fx-green)", matches: (s) => s === "scheduled" },
  { id: "wrap", title: "Final Checks · Sign-Off & Payment", color: "#7C3AED", matches: (s) => s === "final_check" || s === "awaiting_payment" || s === "need_attention" || s === "on_hold" },
  { id: "new", title: "Unassigned · Awaiting Assignment", color: "var(--color-fx-red)", matches: (s) => s === "unassigned" || s === "auto_assigning" },
  { id: "done", title: "Completed · This Week", color: "var(--color-fx-green)", matches: (s) => s === "completed" },
];

export function BeaconList({ filters = DEFAULT_BEACON_FILTERS }: { filters?: BeaconFilters }) {
  const [jobs, setJobs] = useState<ListJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<GroupId, boolean>>({} as Record<GroupId, boolean>);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    void (async () => {
      const supabase = getSupabase();
      let query = supabase
        .from("jobs")
        .select(
          "id, reference, title, status, partner_id, client_name, property_address, partner_name, scheduled_start_at, scheduled_end_at, client_price, extras_amount",
        )
        .neq("status", "cancelled")
        .neq("status", "deleted")
        .is("deleted_at", null);

      const range = getDateRangeForMode(filters);
      if (range) {
        query = query
          .gte("scheduled_start_at", range.fromIso)
          .lte("scheduled_start_at", range.toIso);
      }

      if (filters.partnerId === "__unassigned__") {
        query = query.is("partner_id", null);
      } else if (filters.partnerId !== "all") {
        query = query.eq("partner_id", filters.partnerId);
      }

      const { data } = await query.order("scheduled_start_at", { ascending: true }).limit(200);
      if (cancelled) return;
      setJobs((data ?? []) as ListJob[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [filters]);

  const grouped = useMemo(() => {
    const out = new Map<GroupId, { items: ListJob[]; revenue: number }>(
      GROUPS.map((g) => [g.id, { items: [], revenue: 0 }]),
    );
    for (const j of jobs) {
      const group = GROUPS.find((g) => g.matches(j.status));
      if (!group) continue;
      const bucket = out.get(group.id)!;
      bucket.items.push(j);
      bucket.revenue += (Number(j.client_price) || 0) + (Number(j.extras_amount) || 0);
    }
    return out;
  }, [jobs]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl bg-fx-paper-2/40 h-32 animate-pulse" />
        ))}
      </div>
    );
  }

  const totalShown = jobs.length;
  const activeShown =
    (grouped.get("live")?.items.length ?? 0) +
    (grouped.get("scheduled")?.items.length ?? 0) +
    (grouped.get("wrap")?.items.length ?? 0) +
    (grouped.get("new")?.items.length ?? 0);

  return (
    <div className="bg-card border border-fx-line rounded-xl shadow-fx-1 overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[920px]">
          {GROUPS.map((g) => {
            const bucket = grouped.get(g.id) ?? { items: [], revenue: 0 };
            const items = bucket.items;
            if (items.length === 0) return null;
            const groupRevenue = bucket.revenue;
            const isCollapsed = collapsed[g.id];
            return (
              <div key={g.id}>
                <button
                  type="button"
                  onClick={() => setCollapsed((prev) => ({ ...prev, [g.id]: !prev[g.id] }))}
                  className="w-full grid grid-cols-[6px_140px_1fr_180px_160px_120px_110px_36px] gap-3 items-center px-0 py-2.5 bg-fx-paper border-y border-fx-line hover:bg-fx-paper-2 transition-colors text-left"
                >
                  <span className="h-5 self-stretch" style={{ background: g.color }} />
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fx-mute pl-3 flex items-center gap-2">
                    <ChevronRight
                      className={cn("h-3 w-3 transition-transform", !isCollapsed && "rotate-90")}
                    />
                    {g.title.split("·")[0].trim()}
                  </span>
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fx-mute">
                    {g.title.split("·")[1]?.trim() ?? ""}
                  </span>
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fx-mute">Partner</span>
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fx-mute">Window</span>
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fx-mute">Stage</span>
                  <span
                    className="font-mono text-[11px] tabular-nums text-text-primary text-right pr-1"
                    title="Total revenue in this group"
                  >
                    {formatGbp(groupRevenue)}
                  </span>
                  <span className="inline-grid place-items-center min-w-[22px] h-[18px] px-1.5 bg-fx-ink text-white rounded-full font-mono text-[10.5px] font-medium">
                    {items.length}
                  </span>
                </button>
                {!isCollapsed &&
                  items.map((j) => <ListRow key={j.id} job={j} accent={g.color} />)}
              </div>
            );
          })}
        </div>
      </div>
      <div className="px-4 py-2.5 bg-fx-paper border-t border-fx-line flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.04em] text-fx-mute">
        <span>
          <strong className="text-text-primary font-medium">{activeShown}</strong> active · {totalShown - activeShown} done
        </span>
        <span>
          Updated {format(new Date(), "HH:mm")}
        </span>
      </div>
    </div>
  );
}

function ListRow({ job, accent }: { job: ListJob; accent: string }) {
  const isRisk = job.status === "late";
  const value = Number(job.client_price) + (Number(job.extras_amount) || 0);
  return (
    <Link
      href={`/jobs/${job.id}`}
      className={cn(
        "grid grid-cols-[6px_140px_1fr_180px_160px_120px_110px_36px] gap-3 items-center bg-card border-b border-fx-line hover:bg-fx-paper transition-colors h-11 group",
        isRisk && "bg-gradient-to-r from-fx-red-50/40 to-transparent",
      )}
    >
      <span className="h-full self-stretch" style={{ background: accent }} />
      <span className="font-mono text-[11.5px] text-fx-mute tracking-[0.02em] flex items-center gap-2 pl-3">
        {(job.status === "in_progress" || job.status === "late") && <span className="fx-live-dot" />}
        <strong className="text-text-primary font-medium">{job.reference}</strong>
      </span>
      <span className="flex flex-col min-w-0 pr-3">
        <span className="text-[13px] font-medium text-text-primary truncate leading-[1.25]">{job.title}</span>
        <MicroLabel className="block truncate leading-[1.25]">
          {[shortAddress(job.property_address), job.client_name].filter(Boolean).join(" · ")}
        </MicroLabel>
      </span>
      <span className={cn("flex items-center gap-2 min-w-0", !job.partner_name && "italic")}>
        {job.partner_name ? (
          <>
            <FxAvatar initials={initials(job.partner_name)} tone="coral" size="sm" />
            <span className="text-[13px] text-text-primary truncate">{job.partner_name}</span>
          </>
        ) : (
          <>
            <FxAvatar initials="?" tone="neutral" size="sm" />
            <span className="text-[13px] text-fx-mute">Unassigned</span>
          </>
        )}
      </span>
      <span className="font-mono text-[11px] text-fx-slate whitespace-nowrap">
        {formatWindow(job.scheduled_start_at, job.scheduled_end_at)}
      </span>
      <span className="flex items-center min-w-0">
        <StatusPill status={job.status} />
      </span>
      <span className="font-mono text-[13px] font-medium text-text-primary text-right pr-2 tabular-nums">
        {formatGbp(value)}
      </span>
      <span className="grid place-items-center w-9 h-9 rounded-md text-fx-mute opacity-0 group-hover:opacity-100 group-hover:bg-fx-paper-2 transition-opacity">
        <ChevronRight className="h-4 w-4" />
      </span>
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

function formatWindow(start: string | null, end: string | null): string {
  if (!start) return "—";
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  return e ? `${format(s, "HH:mm")} — ${format(e, "HH:mm")}` : format(s, "HH:mm");
}

function formatGbp(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}
