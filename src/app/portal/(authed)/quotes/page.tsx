import Link from "next/link";
import { FileText, ChevronRight } from "lucide-react";
import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import { fetchAccountQuotes } from "@/lib/server-fetchers/portal-quotes";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  awaiting_customer: "Awaiting your response",
  accepted:          "Accepted",
  rejected:          "Declined",
  converted_to_job:  "Converted to job",
};

const STATUS_COLOR: Record<string, string> = {
  awaiting_customer: "bg-amber-50 text-amber-700",
  accepted:          "bg-emerald-50 text-emerald-700",
  rejected:          "bg-slate-100 text-slate-600",
  converted_to_job:  "bg-emerald-50 text-emerald-700",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default async function PortalQuotesPage() {
  const auth = await requirePortalUserOrRedirect();
  const quotes = await fetchAccountQuotes(auth.accountId);

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-black text-slate-800">Quotes</h1>
        <p className="text-sm text-slate-500 mt-1">
          Review and respond to quotes from the Master team.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {quotes.length === 0 ? (
          <div className="text-center py-16 px-6">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <FileText className="w-6 h-6 text-slate-400" />
            </div>
            <h2 className="text-base font-bold text-slate-800 mb-1">No quotes yet</h2>
            <p className="text-sm text-slate-500">
              Quotes you receive from the Master team will appear here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {quotes.map((q) => (
              <Link
                key={q.id}
                href={`/portal/quotes/${q.id}`}
                className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-slate-400">{q.reference}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      STATUS_COLOR[q.status] ?? "bg-slate-100 text-slate-600"
                    }`}>
                      {STATUS_LABEL[q.status] ?? q.status}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-slate-800 truncate">{q.title}</p>
                  {q.property_address && (
                    <p className="text-xs text-slate-500 truncate mt-0.5">{q.property_address}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-800 tabular-nums">
                      {formatCurrency(Number(q.total_value ?? 0))}
                    </p>
                    <p className="text-xs text-slate-400">{fmtDate(q.created_at)}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
