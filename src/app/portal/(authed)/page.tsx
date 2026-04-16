import Link from "next/link";
import { ClipboardList, FileText, Briefcase, Receipt, ArrowRight, Sparkles } from "lucide-react";
import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import { fetchPortalDashboardKpis } from "@/lib/server-fetchers/portal-dashboard";
import { formatCurrency } from "@/lib/utils";
import { PortalPage, PortalStagger, PortalListItem } from "@/components/portal/portal-motion";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  new:                  "New",
  in_review:            "In review",
  qualified:            "Qualified",
  awaiting_customer:    "Awaiting your response",
  accepted:             "Accepted",
  rejected:             "Rejected",
  scheduled:            "Scheduled",
  in_progress_phase1:   "In progress",
  in_progress_phase2:   "In progress",
  in_progress_phase3:   "In progress",
  final_check:          "Final check",
  awaiting_payment:     "Awaiting payment",
  completed:            "Completed",
  pending:              "Pending",
  partially_paid:       "Partially paid",
  paid:                 "Paid",
  overdue:              "Overdue",
};

function statusLabel(s: string) { return STATUS_LABEL[s] ?? s.replace(/_/g, " "); }
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1)  return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30)   return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default async function PortalDashboardPage() {
  const auth = await requirePortalUserOrRedirect();
  const kpis = await fetchPortalDashboardKpis(auth.accountId);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();
  const firstName = auth.portalUser.full_name?.split(" ")[0] || "there";

  return (
    <PortalPage className="max-w-6xl mx-auto space-y-8">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-8 sm:p-10">
        <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-primary/10 blur-3xl" aria-hidden />
        <div className="relative">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary uppercase tracking-wider mb-2">
            <Sparkles className="w-3 h-3" />
            Master portal
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-text-primary tracking-tight">
            {greeting}, {firstName}
          </h1>
          <p className="text-sm text-text-secondary mt-2 max-w-xl">
            Track requests, quotes, live jobs and invoices in one place. We&rsquo;ll let you know the moment something needs your attention.
          </p>
        </div>
      </div>

      {/* KPI tiles */}
      <PortalStagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <PortalListItem>
          <KpiCard
            href="/portal/requests"
            label="Open requests"
            value={kpis.openRequests.toString()}
            icon={<ClipboardList className="w-5 h-5" />}
            tone="sky"
          />
        </PortalListItem>
        <PortalListItem>
          <KpiCard
            href="/portal/quotes"
            label="Awaiting response"
            value={kpis.pendingQuotes.toString()}
            icon={<FileText className="w-5 h-5" />}
            tone="amber"
          />
        </PortalListItem>
        <PortalListItem>
          <KpiCard
            href="/portal/jobs"
            label="Jobs in progress"
            value={kpis.jobsInProgress.toString()}
            icon={<Briefcase className="w-5 h-5" />}
            tone="emerald"
          />
        </PortalListItem>
        <PortalListItem>
          <KpiCard
            href="/portal/invoices"
            label="Outstanding"
            value={formatCurrency(kpis.outstandingInvoices.total)}
            sublabel={`${kpis.outstandingInvoices.count} unpaid`}
            icon={<Receipt className="w-5 h-5" />}
            tone="rose"
          />
        </PortalListItem>
      </PortalStagger>

      {/* Recent activity */}
      <section className="bg-card rounded-2xl border border-border p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-text-primary">Recent activity</h2>
            <p className="text-xs text-text-tertiary mt-0.5">Last updates across your account.</p>
          </div>
          <Link
            href="/portal/requests?new=1"
            className="text-xs font-semibold text-primary hover:text-primary-hover inline-flex items-center gap-1"
          >
            New request <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {kpis.recentActivity.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-text-tertiary mb-4">No recent activity yet.</p>
            <Link
              href="/portal/requests?new=1"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-hover transition-colors shadow-sm shadow-primary/20"
            >
              Create your first request
            </Link>
          </div>
        ) : (
          <PortalStagger className="divide-y divide-border-light">
            {kpis.recentActivity.map((item) => (
              <PortalListItem key={`${item.type}-${item.id}`}>
                <div className="py-3 flex items-center justify-between gap-4 -mx-2 px-2 rounded-lg hover:bg-surface-hover transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      item.type === "request" ? "bg-sky-50 text-sky-600 dark:bg-sky-950/30 dark:text-sky-400" :
                      item.type === "quote"   ? "bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400" :
                                                "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
                    }`}>
                      {item.type === "request" ? <ClipboardList className="w-4 h-4" /> :
                       item.type === "quote"   ? <FileText className="w-4 h-4" /> :
                                                 <Briefcase className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text-primary truncate">{item.title}</p>
                      <p className="text-xs text-text-secondary">
                        <span className="font-mono">{item.reference}</span> · {statusLabel(item.status)}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-text-tertiary shrink-0">{timeAgo(item.created_at)}</span>
                </div>
              </PortalListItem>
            ))}
          </PortalStagger>
        )}
      </section>
    </PortalPage>
  );
}

interface KpiCardProps {
  href: string;
  label:    string;
  value:    string;
  sublabel?: string;
  icon:     React.ReactNode;
  tone: "sky" | "amber" | "emerald" | "rose";
}

function KpiCard({ href, label, value, sublabel, icon, tone }: KpiCardProps) {
  const toneClass = {
    sky: "bg-sky-50 text-sky-600 dark:bg-sky-950/30 dark:text-sky-400",
    amber: "bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400",
    emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400",
    rose: "bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400",
  }[tone];

  return (
    <Link
      href={href}
      className="group block bg-card rounded-2xl border border-border p-5 transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-border-light"
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">{label}</span>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center transition-transform group-hover:scale-105 ${toneClass}`}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-black text-text-primary tabular-nums">{value}</p>
      {sublabel && <p className="text-xs text-text-tertiary mt-1">{sublabel}</p>}
    </Link>
  );
}
