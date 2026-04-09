import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Briefcase, Calendar, MapPin, User } from "lucide-react";
import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import { fetchPortalTicketDetail } from "@/lib/server-fetchers/portal-tickets";
import { formatCurrency } from "@/lib/utils";
import { TicketChatClient } from "./ticket-chat-client";

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
const JOB_STATUS_LABEL: Record<string, string> = {
  unassigned:         "Pending schedule",
  scheduled:          "Scheduled",
  in_progress_phase1: "In progress",
  in_progress_phase2: "In progress",
  in_progress_phase3: "In progress",
  final_check:        "Final check",
  awaiting_payment:   "Awaiting payment",
  completed:          "Completed",
  cancelled:          "Cancelled",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PortalTicketDetailPage({ params }: PageProps) {
  const auth = await requirePortalUserOrRedirect();
  const { id } = await params;
  const ticket = await fetchPortalTicketDetail(id, auth.accountId);
  if (!ticket) notFound();

  const isOpen = ticket.status !== "resolved" && ticket.status !== "closed";

  return (
    <div className="space-y-6 max-w-4xl">
      <Link
        href="/portal/tickets"
        className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to tickets
      </Link>

      {/* Ticket header */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="px-6 py-5 border-b border-border-light">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-xs font-mono text-text-tertiary">{ticket.reference}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[ticket.status] ?? "bg-surface-tertiary text-text-secondary"}`}>
              {STATUS_LABEL[ticket.status] ?? ticket.status}
            </span>
            <span className="text-xs text-text-tertiary capitalize">{ticket.type.replace(/_/g, " ")}</span>
            <span className="text-xs text-text-tertiary capitalize">{ticket.priority} priority</span>
          </div>
          <h1 className="text-xl font-black text-text-primary">{ticket.subject}</h1>
        </div>

        {/* Embedded job summary card */}
        {ticket.job && (
          <Link
            href={`/portal/jobs/${ticket.job.id}`}
            className="block px-6 py-4 border-b border-border-light bg-surface-secondary hover:bg-surface-hover transition-colors"
          >
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">Related job</p>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-text-tertiary">{ticket.job.reference}</span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
                    {JOB_STATUS_LABEL[ticket.job.status] ?? ticket.job.status.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="text-sm font-semibold text-text-primary">{ticket.job.title}</p>
                <div className="flex items-center gap-4 mt-2 text-xs text-text-tertiary">
                  {ticket.job.scheduled_date && (
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{fmtDate(ticket.job.scheduled_date)}</span>
                  )}
                  {ticket.job.partner_name && (
                    <span className="flex items-center gap-1"><User className="w-3 h-3" />{ticket.job.partner_name}</span>
                  )}
                  {ticket.job.property_address && (
                    <span className="flex items-center gap-1 truncate"><MapPin className="w-3 h-3" />{ticket.job.property_address}</span>
                  )}
                </div>
              </div>
              {/* Progress bar */}
              <div className="w-20 shrink-0 text-right">
                <div className="h-1.5 rounded-full bg-surface-tertiary overflow-hidden mb-1">
                  <div
                    className="h-full bg-orange-500 transition-all"
                    style={{ width: `${Math.min(100, Math.round(((ticket.job.current_phase ?? 0) / Math.max(1, ticket.job.total_phases ?? 2)) * 100))}%` }}
                  />
                </div>
                <span className="text-[10px] text-text-tertiary">
                  Phase {ticket.job.current_phase ?? 0}/{ticket.job.total_phases ?? 2}
                </span>
              </div>
            </div>
          </Link>
        )}

        {/* Chat thread + reply form */}
        <TicketChatClient
          ticketId={ticket.id}
          messages={ticket.messages}
          isOpen={isOpen}
          currentUserId={auth.portalUser.id}
        />
      </div>
    </div>
  );
}
