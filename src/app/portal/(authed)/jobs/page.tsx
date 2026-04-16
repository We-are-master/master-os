import Link from "next/link";
import { Briefcase, ChevronRight, Calendar, MapPin, User } from "lucide-react";
import { JobOverdueBadge } from "@/components/shared/job-overdue-badge";
import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import { fetchAccountJobs } from "@/lib/server-fetchers/portal-jobs";
import { PortalPage, PortalStagger, PortalListItem } from "@/components/portal/portal-motion";

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

const STATUS_STYLE: Record<string, { chip: string; dot: string }> = {
  unassigned:         { chip: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300", dot: "bg-amber-500" },
  auto_assigning:     { chip: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300", dot: "bg-amber-500" },
  scheduled:          { chip: "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300",          dot: "bg-sky-500" },
  late:               { chip: "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300",          dot: "bg-sky-500" },
  in_progress_phase1: { chip: "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300", dot: "bg-orange-500" },
  in_progress_phase2: { chip: "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300", dot: "bg-orange-500" },
  in_progress_phase3: { chip: "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300", dot: "bg-orange-500" },
  in_progress:        { chip: "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300", dot: "bg-orange-500" },
  final_check:        { chip: "bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300", dot: "bg-violet-500" },
  awaiting_payment:   { chip: "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300",         dot: "bg-rose-500" },
  completed:          { chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300", dot: "bg-emerald-500" },
  cancelled:          { chip: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400",      dot: "bg-stone-400" },
  on_hold:            { chip: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",    dot: "bg-amber-500" },
  need_attention:     { chip: "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300",         dot: "bg-rose-500" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default async function PortalJobsPage() {
  const auth = await requirePortalUserOrRedirect();
  const jobs = await fetchAccountJobs(auth.accountId);
  const live = jobs.filter((j) => !["completed", "cancelled"].includes(j.status)).length;

  return (
    <PortalPage className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-black text-text-primary tracking-tight">Jobs</h1>
          <p className="text-sm text-text-secondary mt-1">
            Track work happening across your account in real time.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <Stat value={jobs.length} label="Total" />
          <Stat value={live} label="Active" accent />
        </div>
      </div>

      {jobs.length === 0 ? (
        <EmptyState />
      ) : (
        <PortalStagger className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {jobs.map((j) => {
            const scheduled = j.scheduled_start_at || j.scheduled_date;
            const style = STATUS_STYLE[j.status] ?? { chip: "bg-surface-tertiary text-text-secondary", dot: "bg-stone-400" };
            return (
              <PortalListItem key={j.id}>
                <Link
                  href={`/portal/jobs/${j.id}`}
                  className="group block rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:border-border-light"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-[11px] font-mono text-text-tertiary tracking-wider">{j.reference}</span>
                    <ChevronRight className="w-4 h-4 text-text-tertiary transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${style.chip}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                      {STATUS_LABEL[j.status] ?? j.status.replace(/_/g, " ")}
                    </span>
                    <JobOverdueBadge job={j} />
                  </div>
                  <h3 className="text-base font-bold text-text-primary line-clamp-2 mb-3">{j.title}</h3>
                  <div className="space-y-1.5 text-xs">
                    <Row icon={<Calendar className="w-3 h-3" />} text={fmtDate(scheduled)} />
                    {j.property_address && <Row icon={<MapPin className="w-3 h-3" />} text={j.property_address} truncate />}
                    <Row icon={<User className="w-3 h-3" />} text={j.partner_name || "Master team"} />
                  </div>
                </Link>
              </PortalListItem>
            );
          })}
        </PortalStagger>
      )}
    </PortalPage>
  );
}

function Stat({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className="text-right">
      <p className={`text-2xl font-black tabular-nums leading-none ${accent ? "text-primary" : "text-text-primary"}`}>
        {value}
      </p>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mt-1">{label}</p>
    </div>
  );
}

function Row({ icon, text, truncate }: { icon: React.ReactNode; text: string; truncate?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-text-secondary">
      <span className="text-text-tertiary shrink-0">{icon}</span>
      <span className={truncate ? "truncate" : ""}>{text}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-border bg-card text-center py-20 px-6">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center mb-4">
        <Briefcase className="w-7 h-7 text-primary" />
      </div>
      <h2 className="text-lg font-bold text-text-primary mb-1">No jobs yet</h2>
      <p className="text-sm text-text-secondary max-w-sm mx-auto">
        Once a quote is accepted, the resulting job shows up here with live progress, photos and payment tracking.
      </p>
      <Link
        href="/portal/quotes"
        className="inline-flex items-center gap-1.5 mt-4 text-sm font-semibold text-primary hover:underline"
      >
        Review open quotes
        <ChevronRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
