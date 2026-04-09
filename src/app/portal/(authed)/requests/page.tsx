import Link from "next/link";
import { Plus, ClipboardList } from "lucide-react";
import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import { fetchAccountRequests } from "@/lib/server-fetchers/portal-requests";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  new:                "New",
  in_review:          "In review",
  qualified:          "Qualified",
  converted_to_quote: "Quote sent",
  converted_to_job:   "Job created",
  declined:           "Declined",
};

const STATUS_COLOR: Record<string, string> = {
  new:                "bg-blue-50 text-blue-700",
  in_review:          "bg-amber-50 text-amber-700",
  qualified:          "bg-purple-50 text-purple-700",
  converted_to_quote: "bg-emerald-50 text-emerald-700",
  converted_to_job:   "bg-emerald-50 text-emerald-700",
  declined:           "bg-slate-100 text-slate-600",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default async function PortalRequestsPage() {
  const auth = await requirePortalUserOrRedirect();
  const requests = await fetchAccountRequests(auth.accountId);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-slate-800">Service requests</h1>
          <p className="text-sm text-slate-500 mt-1">
            Open new requests for jobs and track their status as the Master team responds.
          </p>
        </div>
        <Link
          href="/portal/requests/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-orange-600 text-white text-sm font-bold hover:bg-orange-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          New request
        </Link>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {requests.length === 0 ? (
          <div className="text-center py-16 px-6">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <ClipboardList className="w-6 h-6 text-slate-400" />
            </div>
            <h2 className="text-base font-bold text-slate-800 mb-1">No requests yet</h2>
            <p className="text-sm text-slate-500 mb-5">
              Start by opening a new request &mdash; the Master team will get back to you with a quote.
            </p>
            <Link
              href="/portal/requests/new"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-orange-600 text-white text-sm font-bold hover:bg-orange-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Open your first request
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {requests.map((r) => (
              <div key={r.id} className="px-5 py-4 flex items-start justify-between gap-4 hover:bg-slate-50 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-slate-400">{r.reference}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      STATUS_COLOR[r.status] ?? "bg-slate-100 text-slate-600"
                    }`}>
                      {STATUS_LABEL[r.status] ?? r.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-slate-800 truncate">{r.service_type}</p>
                  {r.property_address && (
                    <p className="text-xs text-slate-500 truncate mt-0.5">{r.property_address}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-slate-400">{fmtDate(r.created_at)}</p>
                  {r.owner_name && (
                    <p className="text-xs text-slate-500 mt-0.5">Handled by {r.owner_name}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
