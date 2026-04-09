import { Receipt, ExternalLink } from "lucide-react";
import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import {
  fetchAccountInvoices,
  type PortalInvoiceRow,
} from "@/lib/server-fetchers/portal-invoices";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending:        "Pending",
  partially_paid: "Partially paid",
  overdue:        "Overdue",
  paid:           "Paid",
};
const STATUS_COLOR: Record<string, string> = {
  pending:        "bg-amber-50 text-amber-700",
  partially_paid: "bg-amber-50 text-amber-700",
  overdue:        "bg-rose-50 text-rose-700",
  paid:           "bg-emerald-50 text-emerald-700",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default async function PortalInvoicesPage() {
  const auth = await requirePortalUserOrRedirect();
  const { outstanding, paid } = await fetchAccountInvoices(auth.accountId);

  const outstandingTotal = outstanding.reduce(
    (s, i) => s + Math.max(0, Number(i.amount ?? 0) - Number(i.amount_paid ?? 0)),
    0,
  );

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-black text-slate-800">Invoices</h1>
        <p className="text-sm text-slate-500 mt-1">
          View your invoices and pay outstanding balances.
        </p>
      </div>

      {/* Outstanding tile */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Outstanding</p>
          <p className="text-3xl font-black text-slate-800 tabular-nums mt-1">{formatCurrency(outstandingTotal)}</p>
          <p className="text-xs text-slate-400 mt-0.5">{outstanding.length} invoice{outstanding.length === 1 ? "" : "s"}</p>
        </div>
        <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center">
          <Receipt className="w-6 h-6" />
        </div>
      </div>

      {/* Outstanding list */}
      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <header className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-800">Outstanding</h2>
        </header>
        {outstanding.length === 0 ? (
          <p className="text-sm text-slate-500 px-5 py-8 text-center">No outstanding invoices.</p>
        ) : (
          <InvoiceTable invoices={outstanding} showPay />
        )}
      </section>

      {/* Paid list */}
      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <header className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-800">Paid</h2>
        </header>
        {paid.length === 0 ? (
          <p className="text-sm text-slate-500 px-5 py-8 text-center">No paid invoices yet.</p>
        ) : (
          <InvoiceTable invoices={paid} showPay={false} />
        )}
      </section>
    </div>
  );
}

interface InvoiceTableProps {
  invoices: PortalInvoiceRow[];
  showPay:  boolean;
}
function InvoiceTable({ invoices, showPay }: InvoiceTableProps) {
  return (
    <div className="divide-y divide-slate-100">
      {invoices.map((inv) => {
        const balance = Math.max(0, Number(inv.amount ?? 0) - Number(inv.amount_paid ?? 0));
        return (
          <div key={inv.id} className="px-5 py-4 flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono text-slate-400">{inv.reference}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  STATUS_COLOR[inv.status] ?? "bg-slate-100 text-slate-600"
                }`}>
                  {STATUS_LABEL[inv.status] ?? inv.status}
                </span>
                {inv.invoice_kind && inv.invoice_kind !== "standard" && (
                  <span className="text-xs text-slate-400 capitalize">{inv.invoice_kind}</span>
                )}
              </div>
              <p className="text-sm font-semibold text-slate-800 truncate">
                {inv.client_name ?? "—"}
                {inv.job_reference && <span className="text-slate-400 font-normal"> &middot; {inv.job_reference}</span>}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {showPay ? `Due ${fmtDate(inv.due_date)}` : `Paid ${fmtDate(inv.paid_date)}`}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-bold text-slate-800 tabular-nums">{formatCurrency(Number(inv.amount ?? 0))}</p>
              {showPay && balance < Number(inv.amount ?? 0) && (
                <p className="text-xs text-amber-700 mt-0.5">
                  Balance: {formatCurrency(balance)}
                </p>
              )}
            </div>
            {showPay && inv.stripe_payment_link_url && (
              <a
                href={inv.stripe_payment_link_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-600 text-white text-xs font-bold hover:bg-orange-700 transition-colors shrink-0"
              >
                Pay now
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
