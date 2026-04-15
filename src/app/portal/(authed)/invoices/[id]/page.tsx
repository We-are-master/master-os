import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Clock, Briefcase, Receipt, Calendar } from "lucide-react";
import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import { fetchPortalInvoiceDetail } from "@/lib/server-fetchers/portal-invoice-detail";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  paid:           { label: "Paid",             className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  pending:        { label: "Pending",          className: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
  partially_paid: { label: "Partially paid",   className: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" },
  overdue:        { label: "Overdue",          className: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" },
  cancelled:      { label: "Cancelled",        className: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PortalInvoiceDetailPage({ params }: PageProps) {
  const auth = await requirePortalUserOrRedirect();
  const { id } = await params;
  const invoice = await fetchPortalInvoiceDetail(id, auth.accountId);
  if (!invoice) notFound();

  const badge = STATUS_BADGES[invoice.status] ?? { label: invoice.status, className: "bg-stone-100 text-stone-700" };
  const showPay = invoice.balance > 0 && !!invoice.stripe_payment_link_url;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link
        href="/portal/invoices"
        className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to invoices
      </Link>

      {/* Hero */}
      <section className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="px-6 py-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-mono text-text-tertiary">{invoice.reference}</span>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${badge.className}`}>
                {badge.label}
              </span>
              {invoice.invoice_kind && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-tertiary text-text-secondary">
                  {invoice.invoice_kind}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-black text-text-primary">
              {formatCurrency(invoice.amount)}
            </h1>
            {invoice.job_title && invoice.job_id && (
              <Link
                href={`/portal/jobs/${invoice.job_id}`}
                className="inline-flex items-center gap-1.5 mt-1 text-sm text-primary hover:underline"
              >
                <Briefcase className="w-3.5 h-3.5" />
                {invoice.job_title}
              </Link>
            )}
          </div>

          {showPay && (
            <a
              href={invoice.stripe_payment_link_url!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-hover transition-colors"
            >
              <Clock className="w-4 h-4" />
              Pay {formatCurrency(invoice.balance)} now
            </a>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border-light grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Field icon={<Calendar className="w-3.5 h-3.5" />} label="Issued" value={fmtDate(invoice.issued_at || invoice.created_at)} />
          <Field icon={<Calendar className="w-3.5 h-3.5" />} label="Due" value={fmtDate(invoice.due_date)} />
          <Field icon={<Receipt className="w-3.5 h-3.5" />} label="Amount paid" value={formatCurrency(invoice.amount_paid)} />
          <Field icon={<Receipt className="w-3.5 h-3.5" />} label="Balance" value={formatCurrency(invoice.balance)} />
        </div>

        {invoice.billing_address && (
          <div className="px-6 py-4 border-t border-border-light">
            <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">Billing address</p>
            <p className="text-sm text-text-primary whitespace-pre-line">{invoice.billing_address}</p>
          </div>
        )}
      </section>

      {/* Line items */}
      {invoice.line_items.length > 0 && (
        <section className="bg-card rounded-2xl border border-border overflow-hidden">
          <header className="px-5 py-4 border-b border-border-light">
            <h2 className="text-sm font-semibold text-text-primary">Line items</h2>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-tertiary">
                  <th className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Description</th>
                  <th className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-right">Qty</th>
                  <th className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-right">Unit</th>
                  <th className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {invoice.line_items.map((li) => (
                  <tr key={li.id} className="border-t border-border-light">
                    <td className="px-5 py-3 text-text-primary">{li.description}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-text-secondary">{li.quantity}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-text-secondary">{formatCurrency(li.unit_price)}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold text-text-primary">
                      {formatCurrency(li.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-surface-secondary/50">
                  <td colSpan={3} className="px-5 py-3 text-right text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Total</td>
                  <td className="px-5 py-3 text-right tabular-nums text-base font-black text-text-primary">
                    {formatCurrency(invoice.amount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {/* Payment history */}
      {invoice.payments.length > 0 && (
        <section className="bg-card rounded-2xl border border-border overflow-hidden">
          <header className="px-5 py-4 border-b border-border-light">
            <h2 className="text-sm font-semibold text-text-primary">Payment history</h2>
          </header>
          <ul>
            {invoice.payments.map((p) => (
              <li key={p.id} className="px-5 py-3 flex items-center justify-between border-t border-border-light first:border-t-0">
                <span className="inline-flex items-center gap-2 text-sm text-text-secondary">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  {p.type === "customer_deposit" ? "Deposit" : "Final payment"}
                  <span className="text-xs text-text-tertiary">· {fmtDate(p.paid_at)}</span>
                  {p.method && <span className="text-xs text-text-tertiary">· {p.method}</span>}
                </span>
                <span className="font-semibold text-text-primary tabular-nums">{formatCurrency(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="text-xs text-text-tertiary text-center">
        For billing questions open a ticket from{" "}
        <Link href="/portal/tickets" className="text-primary hover:underline">
          /portal/tickets
        </Link>
        .
      </div>
    </div>
  );
}

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">
        {icon}
        {label}
      </div>
      <p className="text-sm font-semibold text-text-primary tabular-nums">{value}</p>
    </div>
  );
}
