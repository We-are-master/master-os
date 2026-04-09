import Link from "next/link";
import { MessageSquare, Plus, ChevronRight } from "lucide-react";
import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import { fetchAccountTickets } from "@/lib/server-fetchers/portal-tickets";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  open:               "Open",
  in_progress:        "In progress",
  awaiting_customer:  "Awaiting your reply",
  resolved:           "Resolved",
  closed:             "Closed",
};
const STATUS_COLOR: Record<string, string> = {
  open:               "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  in_progress:        "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  awaiting_customer:  "bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400",
  resolved:           "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  closed:             "bg-surface-tertiary text-text-secondary",
};
const PRIORITY_COLOR: Record<string, string> = {
  low:    "text-text-tertiary",
  medium: "text-text-secondary",
  high:   "text-amber-600 dark:text-amber-400",
  urgent: "text-red-600 dark:text-red-400 font-bold",
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
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default async function PortalTicketsPage() {
  const auth    = await requirePortalUserOrRedirect();
  const tickets = await fetchAccountTickets(auth.accountId);

  const open     = tickets.filter((t) => t.status !== "resolved" && t.status !== "closed");
  const resolved = tickets.filter((t) => t.status === "resolved" || t.status === "closed");

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-text-primary">Support tickets</h1>
          <p className="text-sm text-text-secondary mt-1">
            Open tickets for issues, questions or requests. Our team will respond here.
          </p>
        </div>
        <Link
          href="/portal/tickets/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-orange-600 text-white text-sm font-bold hover:bg-orange-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          New ticket
        </Link>
      </div>

      {/* Open tickets */}
      <section className="bg-card rounded-2xl border border-border overflow-hidden">
        <header className="px-5 py-3 border-b border-border-light flex items-center justify-between">
          <h2 className="text-sm font-bold text-text-primary">Open ({open.length})</h2>
        </header>
        {open.length === 0 ? (
          <div className="text-center py-16 px-6">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-surface-tertiary flex items-center justify-center mb-4">
              <MessageSquare className="w-6 h-6 text-text-tertiary" />
            </div>
            <h3 className="text-base font-bold text-text-primary mb-1">No open tickets</h3>
            <p className="text-sm text-text-secondary mb-5">Create a ticket to get in touch with our team.</p>
            <Link
              href="/portal/tickets/new"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-orange-600 text-white text-sm font-bold hover:bg-orange-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Open a ticket
            </Link>
          </div>
        ) : (
          <TicketList tickets={open} />
        )}
      </section>

      {/* Resolved tickets */}
      {resolved.length > 0 && (
        <section className="bg-card rounded-2xl border border-border overflow-hidden">
          <header className="px-5 py-3 border-b border-border-light">
            <h2 className="text-sm font-bold text-text-primary">Resolved ({resolved.length})</h2>
          </header>
          <TicketList tickets={resolved} />
        </section>
      )}
    </div>
  );
}

function TicketList({ tickets }: { tickets: Array<ReturnType<typeof fetchAccountTickets> extends Promise<infer T> ? T extends Array<infer R> ? R : never : never> }) {
  return (
    <div className="divide-y divide-border-light">
      {tickets.map((t) => (
        <Link
          key={t.id}
          href={`/portal/tickets/${t.id}`}
          className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-surface-hover transition-colors"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-mono text-text-tertiary">{t.reference}</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[t.status] ?? "bg-surface-tertiary text-text-secondary"}`}>
                {STATUS_LABEL[t.status] ?? t.status}
              </span>
              <span className="text-xs text-text-tertiary">{TYPE_LABEL[t.type] ?? t.type}</span>
              <span className={`text-xs ${PRIORITY_COLOR[t.priority] ?? "text-text-tertiary"}`}>
                {t.priority}
              </span>
            </div>
            <p className="text-sm font-semibold text-text-primary truncate">{t.subject}</p>
            {t.job_reference && (
              <p className="text-xs text-text-tertiary mt-0.5">Job: {t.job_reference}</p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-text-tertiary">{timeAgo(t.last_message_at ?? t.updated_at)}</span>
            <ChevronRight className="w-4 h-4 text-text-tertiary" />
          </div>
        </Link>
      ))}
    </div>
  );
}
