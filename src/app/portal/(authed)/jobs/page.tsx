import Link from "next/link";
import { Briefcase, ChevronRight } from "lucide-react";
import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import { fetchAccountJobs } from "@/lib/server-fetchers/portal-jobs";

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
  cancelled:          "bg-slate-100 text-slate-600",
  on_hold:            "bg-slate-100 text-slate-600",
  need_attention:     "bg-rose-50 text-rose-700",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default async function PortalJobsPage() {
  const auth = await requirePortalUserOrRedirect();
  const jobs = await fetchAccountJobs(auth.accountId);

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-black text-slate-800">Jobs</h1>
        <p className="text-sm text-slate-500 mt-1">
          Track the work in progress across your account.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {jobs.length === 0 ? (
          <div className="text-center py-16 px-6">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <Briefcase className="w-6 h-6 text-slate-400" />
            </div>
            <h2 className="text-base font-bold text-slate-800 mb-1">No jobs yet</h2>
            <p className="text-sm text-slate-500">
              Once a quote is accepted, the resulting job will show here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {jobs.map((j) => {
              const scheduled = j.scheduled_start_at || j.scheduled_date;
              return (
                <Link
                  key={j.id}
                  href={`/portal/jobs/${j.id}`}
                  className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-slate-400">{j.reference}</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        STATUS_COLOR[j.status] ?? "bg-slate-100 text-slate-600"
                      }`}>
                        {STATUS_LABEL[j.status] ?? j.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-slate-800 truncate">{j.title}</p>
                    {j.property_address && (
                      <p className="text-xs text-slate-500 truncate mt-0.5">{j.property_address}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className="text-xs text-slate-500">{fmtDate(scheduled)}</p>
                      {j.partner_name && (
                        <p className="text-xs text-slate-400 mt-0.5">{j.partner_name}</p>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
