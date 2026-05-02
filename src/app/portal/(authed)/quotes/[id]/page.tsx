import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import { fetchPortalQuoteDetail } from "@/lib/server-fetchers/portal-quotes";
import { formatCurrency } from "@/lib/utils";
import { QuoteActionsClient } from "./quote-actions-client";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  awaiting_customer: "Awaiting your response",
  awaiting_payment:  "Awaiting payment",
  rejected:          "Declined",
  converted_to_job:  "Converted to job",
  draft:             "Draft",
  in_survey:         "In survey",
  bidding:           "Bidding",
};

const STATUS_COLOR: Record<string, string> = {
  awaiting_customer: "bg-amber-50 text-amber-700",
  awaiting_payment:  "bg-amber-50 text-amber-700",
  rejected:          "bg-surface-tertiary text-text-secondary",
  converted_to_job:  "bg-emerald-50 text-emerald-700",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PortalQuoteDetailPage({ params }: PageProps) {
  const auth = await requirePortalUserOrRedirect();
  const { id } = await params;
  const quote  = await fetchPortalQuoteDetail(id, auth.accountId);

  // Hard 404 on missing OR cross-account quote — never reveal existence.
  if (!quote) notFound();

  const canRespond = quote.status === "awaiting_customer";
  const totalValue = Number(quote.total_value ?? 0);

  return (
    <div className="space-y-6 max-w-4xl">
      <Link
        href="/portal/quotes"
        className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to quotes
      </Link>

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-border-light flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-text-tertiary">{quote.reference}</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                STATUS_COLOR[quote.status] ?? "bg-surface-tertiary text-text-secondary"
              }`}>
                {STATUS_LABEL[quote.status] ?? quote.status}
              </span>
            </div>
            <h1 className="text-2xl font-black text-text-primary">{quote.title}</h1>
            {quote.property_address && (
              <p className="text-sm text-text-secondary mt-1">{quote.property_address}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-1 flex items-center justify-end gap-1.5">
              Total
              <span className="inline-block rounded px-1 py-[1px] text-[9px] font-bold tracking-wide bg-emerald-100 text-emerald-700">
                Inc VAT
              </span>
            </p>
            <p className="text-3xl font-black text-text-primary tabular-nums">{formatCurrency(totalValue)}</p>
            {Number(quote.deposit_required) > 0 && (
              <p className="text-xs text-amber-700 mt-1">
                Deposit: {formatCurrency(Number(quote.deposit_required))}
              </p>
            )}
          </div>
        </div>

        {/* Custom message from the team */}
        {quote.email_custom_message && (
          <div className="px-6 py-5 border-b border-border-light bg-surface-secondary">
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">Message from Fixfy</p>
            <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">{quote.email_custom_message}</p>
          </div>
        )}

        {/* Line items */}
        {quote.line_items.length > 0 && (
          <div className="px-6 py-5 border-b border-border-light">
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-3">Line items</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-text-tertiary uppercase tracking-wide">
                  <th className="text-left pb-2 font-semibold">Description</th>
                  <th className="text-right pb-2 font-semibold w-16">Qty</th>
                  <th className="text-right pb-2 font-semibold w-24">Unit</th>
                  <th className="text-right pb-2 font-semibold w-24">Total</th>
                </tr>
              </thead>
              <tbody>
                {quote.line_items.map((li) => (
                  <tr key={li.id} className="border-t border-border-light">
                    <td className="py-3 text-text-primary">{li.description}</td>
                    <td className="py-3 text-right text-text-secondary tabular-nums">{li.quantity}</td>
                    <td className="py-3 text-right text-text-secondary tabular-nums">{formatCurrency(Number(li.unit_price))}</td>
                    <td className="py-3 text-right text-text-primary font-semibold tabular-nums">{formatCurrency(Number(li.total))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border">
                  <td colSpan={3} className="pt-3 text-right text-sm font-semibold text-text-secondary">
                    Total
                    <span className="ml-1 inline-block rounded px-1 py-[1px] text-[9px] font-bold tracking-wide bg-emerald-100 text-emerald-700 align-middle">
                      Inc VAT
                    </span>
                  </td>
                  <td className="pt-3 text-right text-base font-black text-text-primary tabular-nums">
                    {formatCurrency(totalValue)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Scope of work */}
        {quote.scope && (
          <div className="px-6 py-5 border-b border-border-light">
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">Scope of work</p>
            <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">{quote.scope}</p>
          </div>
        )}

        {/* Actions */}
        <div className="px-6 py-5">
          {canRespond ? (
            <QuoteActionsClient quoteId={quote.id} reference={quote.reference} />
          ) : quote.status === "rejected" ? (
            <div className="bg-surface-secondary border border-border rounded-xl p-4">
              <p className="text-sm font-semibold text-text-primary mb-1">You declined this quote</p>
              {quote.rejection_reason && (
                <p className="text-xs text-text-secondary">Reason: {quote.rejection_reason}</p>
              )}
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-emerald-800">Quote accepted</p>
              <p className="text-xs text-emerald-700 mt-1">
                Check the Jobs tab for the work that&rsquo;s been scheduled.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
