"use client";

import Link from "next/link";
import { Receipt, CheckCircle2, Clock } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { PortalCustomerPayment, PortalLinkedInvoice } from "@/lib/server-fetchers/portal-job-detail";

interface JobFinancialCardProps {
  clientPrice: number;
  depositRequired: number;
  depositPaid: boolean;
  finalPayment: number;
  finalPaid: boolean;
  payments: PortalCustomerPayment[];
  invoices: PortalLinkedInvoice[];
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Client-facing financial panel. Shows:
 *   - Total + deposit + final split (what the client pays)
 *   - Payment history (customer_deposit / customer_final rows only — RLS
 *     also enforces this but we double-check via the prop types)
 *   - Linked invoices with pay-now CTA
 *
 * Intentionally hides: partner_cost, materials_cost, margin, self_bill.
 */
export function JobFinancialCard({
  clientPrice,
  depositRequired,
  depositPaid,
  finalPayment,
  finalPaid,
  payments,
  invoices,
}: JobFinancialCardProps) {
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const outstanding = Math.max(0, clientPrice - totalPaid);
  const outstandingInvoice = invoices.find((inv) => inv.balance > 0 && inv.stripe_payment_link_url);

  return (
    <section className="bg-card rounded-2xl border border-border overflow-hidden">
      <header className="px-5 py-4 border-b border-border-light">
        <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Receipt className="w-4 h-4 text-text-tertiary" />
          Financial overview
        </h2>
      </header>

      <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-3 gap-4 border-b border-border-light">
        <FigureCell label="Total value" value={formatCurrency(clientPrice)} accent="primary" />
        <FigureCell
          label="Deposit"
          value={depositRequired > 0 ? formatCurrency(depositRequired) : "—"}
          caption={depositRequired > 0 ? (depositPaid ? "Paid" : "Pending") : "Not required"}
          accent={depositPaid ? "success" : "neutral"}
        />
        <FigureCell
          label="Final balance"
          value={formatCurrency(finalPayment || outstanding)}
          caption={finalPaid ? "Paid" : outstanding > 0 ? "Pending" : "—"}
          accent={finalPaid ? "success" : outstanding > 0 ? "warning" : "neutral"}
        />
      </div>

      {payments.length > 0 && (
        <div className="px-5 py-4 border-b border-border-light">
          <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-3">
            Payment history
          </p>
          <ul className="space-y-2">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-text-secondary">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  {p.type === "customer_deposit" ? "Deposit" : "Final payment"}
                  <span className="text-text-tertiary text-xs">· {fmtDate(p.paid_at)}</span>
                  {p.method && <span className="text-text-tertiary text-xs">· {p.method}</span>}
                </span>
                <span className="font-semibold text-text-primary">{formatCurrency(p.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {invoices.length > 0 && (
        <div className="px-5 py-4 border-b border-border-light">
          <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-3">
            Invoices
          </p>
          <ul className="space-y-2">
            {invoices.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 text-sm">
                <Link
                  href={`/portal/invoices/${inv.id}`}
                  className="flex-1 min-w-0 flex items-center gap-2 hover:text-primary"
                >
                  <Receipt className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                  <span className="font-mono text-xs text-text-tertiary">{inv.reference}</span>
                  {inv.invoice_kind && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-surface-tertiary text-text-secondary">
                      {inv.invoice_kind}
                    </span>
                  )}
                  <span className="text-text-secondary truncate">
                    {inv.status === "paid" ? "Paid" : inv.balance > 0 ? `${formatCurrency(inv.balance)} due` : "—"}
                  </span>
                </Link>
                <span className="font-semibold text-text-primary">
                  {formatCurrency(inv.amount_due)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {outstandingInvoice?.stripe_payment_link_url && (
        <div className="px-5 py-4">
          <a
            href={outstandingInvoice.stripe_payment_link_url}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-hover transition-colors"
          >
            <Clock className="w-4 h-4" />
            Pay {formatCurrency(outstandingInvoice.balance)} now
          </a>
        </div>
      )}
    </section>
  );
}

interface FigureCellProps {
  label: string;
  value: string;
  caption?: string;
  accent: "primary" | "success" | "warning" | "neutral";
}
function FigureCell({ label, value, caption, accent }: FigureCellProps) {
  const captionClass = {
    primary: "text-primary",
    success: "text-emerald-600 dark:text-emerald-400",
    warning: "text-amber-600 dark:text-amber-400",
    neutral: "text-text-tertiary",
  }[accent];
  return (
    <div>
      <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-black text-text-primary tabular-nums mt-1">{value}</p>
      {caption && <p className={`text-[11px] font-semibold mt-0.5 ${captionClass}`}>{caption}</p>}
    </div>
  );
}
