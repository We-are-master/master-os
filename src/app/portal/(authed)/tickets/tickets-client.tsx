"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { MessageSquare, Plus, ChevronRight, Zap, Clock } from "lucide-react";
import { PortalPage, PortalStagger, PortalListItem } from "@/components/portal/portal-motion";
import { NewTicketDrawer, type NewTicketDrawerJob } from "./new-ticket-drawer";

const STATUS_STYLE: Record<string, { label: string; chip: string; dot: string }> = {
  open:               { label: "Open",               chip: "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300",          dot: "bg-sky-500" },
  in_progress:        { label: "In progress",        chip: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",  dot: "bg-amber-500" },
  awaiting_customer:  { label: "Awaiting you",       chip: "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300", dot: "bg-orange-500" },
  resolved:           { label: "Resolved",           chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300", dot: "bg-emerald-500" },
  closed:             { label: "Closed",             chip: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400",    dot: "bg-stone-400" },
};

const PRIORITY_STYLE: Record<string, string> = {
  low:    "text-text-tertiary",
  medium: "text-text-secondary",
  high:   "text-amber-600 dark:text-amber-400",
  urgent: "text-red-600 dark:text-red-400",
};

const TYPE_LABEL: Record<string, string> = {
  general:     "General",
  billing:     "Billing",
  job_related: "Job related",
  complaint:   "Complaint",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1)  return "just now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export interface PortalTicketRow {
  id: string;
  reference: string;
  subject: string;
  status: string;
  priority: string;
  type: string;
  job_reference: string | null;
  last_message_at: string | null;
  updated_at: string;
}

interface TicketsClientProps {
  tickets: PortalTicketRow[];
  jobs: NewTicketDrawerJob[];
}

export function TicketsClient({ tickets, jobs }: TicketsClientProps) {
  const searchParams = useSearchParams();
  const preselectedJob = searchParams?.get("job") ?? undefined;
  const autoOpen = searchParams?.get("new") === "1" || !!preselectedJob;
  const [drawerOpen, setDrawerOpen] = useState(autoOpen);

  const open      = tickets.filter((t) => t.status !== "resolved" && t.status !== "closed");
  const resolved  = tickets.filter((t) => t.status === "resolved" || t.status === "closed");
  const awaitingYou = open.filter((t) => t.status === "awaiting_customer").length;

  return (
    <PortalPage className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-black text-text-primary tracking-tight">Support tickets</h1>
          <p className="text-sm text-text-secondary mt-1">
            Ask questions, report issues, or request help — the Master team responds inside each thread.
          </p>
        </div>
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.97 }}
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors shadow-sm shadow-primary/20"
        >
          <Plus className="w-4 h-4" />
          New ticket
        </motion.button>
      </div>

      {open.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <SummaryCell icon={<Zap className="w-4 h-4" />} label="Open" value={open.length} tone="sky" />
          <SummaryCell
            icon={<Clock className="w-4 h-4" />}
            label="Needs your reply"
            value={awaitingYou}
            tone={awaitingYou > 0 ? "orange" : "neutral"}
          />
        </div>
      )}

      {open.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-text-primary mb-3">
            Open <span className="text-xs font-semibold text-text-tertiary ml-1">({open.length})</span>
          </h2>
          <PortalStagger className="space-y-2">
            {open.map((t) => (
              <PortalListItem key={t.id}>
                <TicketCard ticket={t} />
              </PortalListItem>
            ))}
          </PortalStagger>
        </section>
      )}

      {open.length === 0 && <EmptyOpen onNew={() => setDrawerOpen(true)} />}

      {resolved.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-text-tertiary mb-3">
            Resolved <span className="text-xs font-semibold text-text-tertiary ml-1">({resolved.length})</span>
          </h2>
          <PortalStagger className="space-y-2">
            {resolved.map((t) => (
              <PortalListItem key={t.id}>
                <TicketCard ticket={t} muted />
              </PortalListItem>
            ))}
          </PortalStagger>
        </section>
      )}

      <NewTicketDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        jobs={jobs}
        defaultJobId={preselectedJob}
      />
    </PortalPage>
  );
}

function SummaryCell({
  icon, label, value, tone,
}: { icon: React.ReactNode; label: string; value: number; tone: "sky" | "orange" | "neutral" }) {
  const toneClass = {
    sky: "bg-sky-50 text-sky-600 dark:bg-sky-950/30 dark:text-sky-400",
    orange: "bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400",
    neutral: "bg-surface-tertiary text-text-tertiary",
  }[tone];
  return (
    <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${toneClass}`}>
        {icon}
      </div>
      <div>
        <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">{label}</p>
        <p className="text-xl font-black text-text-primary tabular-nums">{value}</p>
      </div>
    </div>
  );
}

function TicketCard({ ticket: t, muted = false }: { ticket: PortalTicketRow; muted?: boolean }) {
  const style = STATUS_STYLE[t.status] ?? { label: t.status, chip: "bg-surface-tertiary text-text-secondary", dot: "bg-stone-400" };
  return (
    <Link
      href={`/portal/tickets/${t.id}`}
      className={`group block rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-border-light ${muted ? "opacity-75" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[11px] font-mono text-text-tertiary tracking-wider">{t.reference}</span>
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${style.chip}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
              {style.label}
            </span>
            <span className="text-[11px] text-text-tertiary">{TYPE_LABEL[t.type] ?? t.type}</span>
            {t.priority !== "low" && t.priority !== "medium" && (
              <span className={`text-[11px] font-semibold uppercase tracking-wide ${PRIORITY_STYLE[t.priority] ?? "text-text-tertiary"}`}>
                {t.priority}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-text-primary truncate">{t.subject}</p>
          {t.job_reference && (
            <p className="text-[11px] text-text-tertiary mt-0.5">Job: {t.job_reference}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 text-text-tertiary">
          <span className="text-xs">{timeAgo(t.last_message_at ?? t.updated_at)}</span>
          <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}

function EmptyOpen({ onNew }: { onNew: () => void }) {
  return (
    <div className="rounded-2xl border border-border bg-card text-center py-16 px-6">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center mb-4">
        <MessageSquare className="w-7 h-7 text-primary" />
      </div>
      <h2 className="text-lg font-bold text-text-primary mb-1">No open tickets</h2>
      <p className="text-sm text-text-secondary mb-5 max-w-sm mx-auto">
        Have a question, issue, or request? Open a ticket and the Master team will jump in.
      </p>
      <button
        type="button"
        onClick={onNew}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors"
      >
        <Plus className="w-4 h-4" />
        Open a ticket
      </button>
    </div>
  );
}
