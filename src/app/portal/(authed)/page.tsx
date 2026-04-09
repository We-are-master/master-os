import Link from "next/link";
import { ClipboardList, FileText, Briefcase, Receipt, ArrowRight } from "lucide-react";
import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import { fetchPortalDashboardKpis } from "@/lib/server-fetchers/portal-dashboard";
import { formatCurrency } from "@/lib/utils";

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
    <div className="space-y-8 max-w-6xl">
      <div>
        <h1 className="text-2xl font-black text-slate-800">{greeting}, {firstName}</h1>
        <p className="text-sm text-slate-500 mt-1">
          Here&rsquo;s what&rsquo;s happening with your account today.
        </p>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/portal/requests" className="group">
          <KpiCard
            label="Open requests"
            value={kpis.openRequests.toString()}
            icon={<ClipboardList className="w-5 h-5" />}
            color="bg-blue-50 text-blue-700"
          />
        </Link>
        <Link href="/portal/quotes" className="group">
          <KpiCard
            label="Quotes awaiting response"
            value={kpis.pendingQuotes.toString()}
            icon={<FileText className="w-5 h-5" />}
            color="bg-amber-50 text-amber-700"
          />
        </Link>
        <Link href="/portal/jobs" className="group">
          <KpiCard
            label="Jobs in progress"
            value={kpis.jobsInProgress.toString()}
            icon={<Briefcase className="w-5 h-5" />}
            color="bg-emerald-50 text-emerald-700"
          />
        </Link>
        <Link href="/portal/invoices" className="group">
          <KpiCard
            label="Outstanding invoices"
            value={formatCurrency(kpis.outstandingInvoices.total)}
            sublabel={`${kpis.outstandingInvoices.count} unpaid`}
            icon={<Receipt className="w-5 h-5" />}
            color="bg-rose-50 text-rose-700"
          />
        </Link>
      </div>

      {/* Recent activity */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-800">Recent activity</h2>
          <Link href="/portal/requests" className="text-xs font-semibold text-orange-600 hover:text-orange-700 flex items-center gap-1">
            New request <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {kpis.recentActivity.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-slate-400">No recent activity yet.</p>
            <Link
              href="/portal/requests/new"
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 text-white text-sm font-semibold hover:bg-orange-700 transition-colors"
            >
              Create your first request
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {kpis.recentActivity.map((item) => (
              <li key={`${item.type}-${item.id}`} className="py-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    item.type === "request" ? "bg-blue-50 text-blue-600" :
                    item.type === "quote"   ? "bg-amber-50 text-amber-600" :
                                              "bg-emerald-50 text-emerald-600"
                  }`}>
                    {item.type === "request" ? <ClipboardList className="w-4 h-4" /> :
                     item.type === "quote"   ? <FileText className="w-4 h-4" /> :
                                               <Briefcase className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{item.title}</p>
                    <p className="text-xs text-slate-500">
                      {item.reference} &middot; {statusLabel(item.status)}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-slate-400 shrink-0">{timeAgo(item.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

interface KpiCardProps {
  label:    string;
  value:    string;
  sublabel?: string;
  icon:     React.ReactNode;
  color:    string;
}

function KpiCard({ label, value, sublabel, icon, color }: KpiCardProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 hover:border-slate-300 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</span>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-black text-slate-800 tabular-nums">{value}</p>
      {sublabel && (
        <p className="text-xs text-slate-400 mt-1">{sublabel}</p>
      )}
    </div>
  );
}
