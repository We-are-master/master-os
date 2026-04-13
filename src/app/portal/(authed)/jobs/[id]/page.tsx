import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Calendar, MapPin, User, Briefcase } from "lucide-react";
import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import { fetchPortalJobDetail } from "@/lib/server-fetchers/portal-jobs";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  unassigned:         "Pending schedule",
  auto_assigning:     "Pending schedule",
  scheduled:          "Scheduled",
  late:               "Scheduled",
  in_progress_phase1: "In progress",
  in_progress_phase2: "In progress",
  in_progress_phase3: "In progress",
  in_progress:        "In progress",
  final_check:        "Final check",
  awaiting_payment:   "Awaiting payment",
  completed:          "Completed",
  cancelled:          "Cancelled",
  on_hold:            "On hold",
  need_attention:     "Needs attention",
};

const STATUS_COLOR: Record<string, string> = {
  unassigned:         "bg-amber-50 text-amber-700",
  auto_assigning:     "bg-amber-50 text-amber-700",
  scheduled:          "bg-blue-50 text-blue-700",
  late:               "bg-blue-50 text-blue-700",
  in_progress_phase1: "bg-orange-50 text-orange-700",
  in_progress_phase2: "bg-orange-50 text-orange-700",
  in_progress_phase3: "bg-orange-50 text-orange-700",
  in_progress:        "bg-orange-50 text-orange-700",
  final_check:        "bg-purple-50 text-purple-700",
  awaiting_payment:   "bg-rose-50 text-rose-700",
  completed:          "bg-emerald-50 text-emerald-700",
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PortalJobDetailPage({ params }: PageProps) {
  const auth = await requirePortalUserOrRedirect();
  const { id } = await params;
  const job = await fetchPortalJobDetail(id, auth.accountId);
  if (!job) notFound();

  const phase = Number(job.current_phase ?? 0);
  const total = Math.max(1, Number(job.total_phases ?? 2));
  const pct   = Math.min(100, Math.round((phase / total) * 100));

  return (
    <div className="space-y-6 max-w-4xl">
      <Link
        href="/portal/jobs"
        className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to jobs
      </Link>

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="px-6 py-5 border-b border-border-light">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-text-tertiary">{job.reference}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              STATUS_COLOR[job.status] ?? "bg-surface-tertiary text-text-secondary"
            }`}>
              {STATUS_LABEL[job.status] ?? job.status.replace(/_/g, " ")}
            </span>
          </div>
          <h1 className="text-2xl font-black text-text-primary">{job.title}</h1>
        </div>

        {/* Progress bar */}
        {job.status !== "cancelled" && (
          <div className="px-6 py-5 border-b border-border-light">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Progress</p>
              <p className="text-xs text-text-secondary">Phase {phase} of {total}</p>
            </div>
            <div className="h-2 rounded-full bg-surface-tertiary overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-orange-400 to-orange-600 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Details */}
        <div className="px-6 py-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DetailRow
            icon={<Calendar className="w-4 h-4" />}
            label="Scheduled"
            value={fmtDateTime(job.scheduled_start_at) !== "—" ? fmtDateTime(job.scheduled_start_at) : fmtDate(job.scheduled_date)}
          />
          <DetailRow
            icon={<User className="w-4 h-4" />}
            label="Assigned to"
            value={job.partner_name || "Master team"}
          />
          {job.property_address && (
            <DetailRow
              icon={<MapPin className="w-4 h-4" />}
              label="Address"
              value={job.property_address}
              wide
            />
          )}
          <DetailRow
            icon={<Briefcase className="w-4 h-4" />}
            label="Total value"
            value={formatCurrency(job.client_price)}
          />
        </div>

        {job.scope && (
          <div className="px-6 py-5 border-t border-border-light">
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">Scope of work</p>
            <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">{job.scope}</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface DetailRowProps { icon: React.ReactNode; label: string; value: string; wide?: boolean }
function DetailRow({ icon, label, value, wide }: DetailRowProps) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <div className="flex items-center gap-2 text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-1">
        <span className="text-text-tertiary">{icon}</span>
        {label}
      </div>
      <p className="text-sm font-semibold text-text-primary">{value}</p>
    </div>
  );
}
