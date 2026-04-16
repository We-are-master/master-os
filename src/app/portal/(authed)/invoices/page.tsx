import Link from "next/link";
import { Receipt, ExternalLink, ChevronRight, Clock, CheckCircle2 } from "lucide-react";
import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import {
  fetchAccountInvoices,
  type PortalInvoiceRow,
} from "@/lib/server-fetchers/portal-invoices";
import { formatCurrency } from "@/lib/utils";
import { PortalPage, PortalStagger, PortalListItem } from "@/components/portal/portal-motion";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, { label: string; chip: string; dot: string }> = {
  pending:        { label: "Pending",        chip: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",   dot: "bg-amber-500" },
  partially_paid: { label: "Partially paid", chip: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",   dot: "bg-amber-500" },
  overdue:        { label: "Overdue",        chip: "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300",       dot: "bg-rose-500" },
  paid:           { label: "Paid",           chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300", dot: "bg-emerald-500" },
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
  const paidTotal = paid.reduce((s, i) => s + Number(i.amount ?? 0), 0);

  return (
    <PortalPage className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-black text-text-primary tracking-tight">Invoices</h1>
        <p className="text-sm text-text-secondary mt-1">
          Review balances and settle invoices securely.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SummaryCard
          icon={<Clock className="w-5 h-5" />}
          label="Outstanding"
          value={formatCurrency(outstandingTotal)}
          sub={`${outstanding.length} invoice${outstanding.length === 1 ? "" : "s"}`}
          tone={outstandingTotal > 0 ? "warn" : "neutral"}
        />
        <SummaryCard
          icon={<CheckCircle2 className="w-5 h-5" />}
          label="Paid all-time"
          value={formatCurrency(paidTotal)}
          sub={`${paid.length} invoice${paid.length === 1 ? "" : "s"}`}
          tone="success"
        />
      </div>

      {outstanding.length > 0 && (
        <Section title="Outstanding" count={outstanding.length}>
          <PortalStagger className="space-y-2">
            {outstanding.map((inv) => (
              <PortalListItem key={inv.id}>
                <InvoiceRow invoice={inv} showPay />
              </PortalListItem>
            ))}
          </PortalStagger>
        </Section>
      )}

      {paid.length > 0 && (
        <Section title="Paid" count={paid.length} muted>
          <PortalStagger className="space-y-2">
            {paid.map((inv) => (
              <PortalListItem key={inv.id}>
                <InvoiceRow invoice={inv} showPay={false} />
              </PortalListItem>
            ))}
          </PortalStagger>
        </Section>
      )}

      {outstanding.length === 0 && paid.length === 0 && <EmptyState />}
    </PortalPage>
  );
}

function SummaryCard({
  icon, label, value, sub, tone,
}: { icon: React.ReactNode; label: string; value: string; sub: string; tone: "warn" | "success" | "neutral" }) {
  const toneClass = {
    warn: "bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400",
    success: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400",
    neutral: "bg-surface-tertiary text-text-tertiary",
  }[tone];
  return (
    <div className="bg-card rounded-2xl border border-border p-5 flex items-center justify-between">
      <div>
        <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-black text-text-primary tabular-nums mt-1">{value}</p>
        <p className="text-xs text-text-tertiary mt-0.5">{sub}</p>
      </div>
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${toneClass}`}>
        {icon}
      </div>
    </div>
  );
}

function Section({ title, count, muted = false, children }: { title: string; count: number; muted?: boolean; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className={`text-sm font-bold ${muted ? "text-text-tertiary" : "text-text-primary"}`}>
          {title}
          <span className="ml-2 text-xs font-semibold text-text-tertiary">({count})</span>
        </h2>
      </div>
      {children}
    </section>
  );
}

function InvoiceRow({ invoice, showPay }: { invoice: PortalInvoiceRow; showPay: boolean }) {
  const balance = Math.max(0, Number(invoice.amount ?? 0) - Number(invoice.amount_paid ?? 0));
  const style = STATUS_STYLE[invoice.status] ?? { label: invoice.status, chip: "bg-surface-tertiary text-text-secondary", dot: "bg-stone-400" };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-4 transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-border-light">
      <Link href={`/portal/invoices/${invoice.id}`} className="min-w-0 flex-1 flex items-center gap-3 group">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[11px] font-mono text-text-tertiary tracking-wider">{invoice.reference}</span>
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${style.chip}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
              {style.label}
            </span>
            {invoice.invoice_kind && invoice.invoice_kind !== "standard" && (
              <span className="text-[11px] text-text-tertiary capitalize">{invoice.invoice_kind}</span>
            )}
          </div>
          <p className="text-sm font-semibold text-text-primary truncate">
            {invoice.client_name ?? "—"}
            {invoice.job_reference && (
              <span className="text-text-tertiary font-normal"> · {invoice.job_reference}</span>
            )}
          </p>
          <p className="text-xs text-text-secondary mt-0.5">
            {showPay ? `Due ${fmtDate(invoice.due_date)}` : `Paid ${fmtDate(invoice.paid_date)}`}
          </p>
        </div>
        <div className="text-right shrink-0 pr-2">
          <p className="text-sm font-bold text-text-primary tabular-nums">{formatCurrency(Number(invoice.amount ?? 0))}</p>
          {showPay && balance < Number(invoice.amount ?? 0) && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
              {formatCurrency(balance)} left
            </p>
          )}
        </div>
        <ChevronRight className="w-4 h-4 text-text-tertiary transition-transform group-hover:translate-x-0.5" />
      </Link>
      {showPay && invoice.stripe_payment_link_url && (
        <a
          href={invoice.stripe_payment_link_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary-hover transition-colors shrink-0 shadow-sm"
        >
          Pay now
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-border bg-card text-center py-20 px-6">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 flex items-center justify-center mb-4">
        <Receipt className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
      </div>
      <h2 className="text-lg font-bold text-text-primary mb-1">All clear</h2>
      <p className="text-sm text-text-secondary max-w-sm mx-auto">
        No invoices to show yet. They appear here as jobs are completed.
      </p>
    </div>
  );
}
