"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import PublicReportForm from "./public-report-form";
import PublicBidForm from "./public-bid-form";
import { pickReportTemplate } from "@/lib/public-report-templates";

type LinkedJob = {
  id:                    string;
  reference:             string;
  serviceType:           string | null;
  status:                string;
  title:                 string | null;
  propertyAddress:       string | null;
  startReportSubmitted:  boolean;
  finalReportSubmitted:  boolean;
};

type BidContext = {
  partnerName: string | null;
  existingBid: { amount: number; jobType: "fixed" | "hourly"; notes: string | null } | null;
};

type QuoteSummary = {
  reference: string;
  title: string;
  clientName: string;
  propertyAddress: string | null;
  scope: string | null;
  serviceType?: string | null;
  totalValue: number;
  depositRequired: number;
  startDateOption1: string | null;
  startDateOption2: string | null;
  status: string;
  lineItems: { description: string; quantity: number; unitPrice: number; total: number }[];
  /** Distinguishes the three token surfaces (customer accept/reject, partner bid, partner report). */
  tokenKind?: "customer" | "partner_bid" | "partner_report";
  linkedJob?: LinkedJob | null;
  bidContext?: BidContext | null;
};

function formatMoney(n: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP" }).format(n);
}

function QuoteRespondContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const action = searchParams.get("action");

  const [rejectionReason, setRejectionReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<QuoteSummary | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [infoError, setInfoError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoadingInfo(false);
      return;
    }
    let cancelled = false;
    setLoadingInfo(true);
    setInfoError(null);
    fetch(`/api/quotes/respond-info?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data: { error?: string } & Partial<QuoteSummary>) => {
        if (cancelled) return;
        if (data.error) {
          setInfoError(data.error);
          setSummary(null);
        } else {
          setSummary({
            reference: data.reference ?? "",
            title: data.title ?? "",
            clientName: data.clientName ?? "",
            propertyAddress: data.propertyAddress ?? null,
            scope: data.scope ?? null,
            totalValue: data.totalValue ?? 0,
            depositRequired: data.depositRequired ?? 0,
            startDateOption1: data.startDateOption1 ?? null,
            startDateOption2: data.startDateOption2 ?? null,
            status: data.status ?? "",
            lineItems: data.lineItems ?? [],
          });
        }
      })
      .catch(() => {
        if (!cancelled) setInfoError("Could not load quote details.");
      })
      .finally(() => {
        if (!cancelled) setLoadingInfo(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-stone-200 p-8 text-center">
          <h1 className="text-xl font-bold text-stone-800">Invalid link</h1>
          <p className="text-stone-600 mt-2">This link is missing its token. Please use the link from your email.</p>
        </div>
      </div>
    );
  }

  // `action` is only meaningful for customer accept/reject tokens (legacy
  // emailed CTAs). Partner bid + partner report tokens land here with no
  // `action` query param — the page below picks the right form by
  // `summary.tokenKind`. Skip the `action` shape validation in those cases.
  const isCustomerActionToken = summary?.tokenKind === "customer";

  if (isCustomerActionToken && action && action !== "accept" && action !== "reject") {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-stone-200 p-8 text-center">
          <h1 className="text-xl font-bold text-stone-800">Invalid action</h1>
          <p className="text-stone-600 mt-2">Please use the Accept or Reject button from your email.</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/quotes/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          action,
          ...(action === "reject" && rejectionReason.trim() ? { rejectionReason: rejectionReason.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      if (data.paymentLinkUrl) {
        window.location.href = data.paymentLinkUrl;
        return;
      }
      setResult({ success: true, message: data.message ?? (action === "accept" ? "Quote accepted." : "Quote declined.") });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-stone-200 p-8 text-center">
          <div className={`w-14 h-14 rounded-full mx-auto flex items-center justify-center ${result.success ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"}`}>
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          </div>
          <h1 className="text-xl font-bold text-stone-800 mt-4">Thank you</h1>
          <p className="text-stone-600 mt-2">{result.message}</p>
        </div>
      </div>
    );
  }

  const isAccept = action === "accept";

  // ─── Partner bid submission form ─────────────────────────────────────
  // The partner-scoped bid token (createPartnerBidToken) routes here when
  // the quote is still in `bidding` state. Each invited partner has their
  // own link, so bids written through this surface are traceable per
  // partner via the audit log + quote_bids row.
  if (token && summary?.tokenKind === "partner_bid" && summary.status === "bidding" && summary.bidContext) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center p-6">
        <div className="max-w-lg w-full max-h-[min(100vh-3rem,900px)] flex flex-col overflow-hidden rounded-2xl shadow-lg border border-stone-200 bg-white">
          <div className="flex-1 overflow-y-auto p-8">
            <PublicBidForm
              token={token}
              quoteReference={summary.reference}
              quoteTitle={summary.title}
              propertyAddress={summary.propertyAddress}
              scope={summary.scope}
              partnerName={summary.bidContext.partnerName}
              existingBid={summary.bidContext.existingBid}
              onSubmitted={(msg) => setResult({ success: true, message: msg })}
            />
          </div>
        </div>
      </div>
    );
  }
  if (token && summary?.tokenKind === "partner_bid" && summary.status !== "bidding") {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-stone-200 p-8 text-center">
          <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center bg-stone-100 text-stone-500">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
          </div>
          <h1 className="text-xl font-bold text-stone-800 mt-4">Bidding closed</h1>
          <p className="text-stone-600 mt-2">This quote is no longer accepting bids.</p>
        </div>
      </div>
    );
  }

  // ─── Partner report submission form ──────────────────────────────────
  // The partner-scoped token (createPartnerReportToken) routes here when
  // the job exists and the report is still pending. Customer tokens never
  // reach this branch: respond-info only surfaces `linkedJob` when the
  // token is partner-typed and matches the job's current partner_id.
  if (token && summary?.linkedJob && !(summary.linkedJob.finalReportSubmitted && summary.linkedJob.startReportSubmitted)) {
    const job = summary.linkedJob;
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center p-6">
        <div className="max-w-lg w-full max-h-[min(100vh-3rem,900px)] flex flex-col overflow-hidden rounded-2xl shadow-lg border border-stone-200 bg-white">
          <div className="flex-1 overflow-y-auto p-8">
            <PublicReportForm
              token={token}
              jobReference={job.reference}
              jobTitle={job.title ?? summary.title}
              propertyAddress={job.propertyAddress ?? summary.propertyAddress ?? ""}
              serviceType={job.serviceType ?? summary.serviceType ?? null}
              template={pickReportTemplate({
                serviceType: job.serviceType ?? summary.serviceType ?? null,
                title: job.title ?? summary.title,
              })}
              onSubmitted={() =>
                setResult({
                  success: true,
                  message: "Report submitted. Our team will review it shortly.",
                })
              }
            />
          </div>
        </div>
      </div>
    );
  }
  if (token && summary?.linkedJob?.finalReportSubmitted && summary.linkedJob.startReportSubmitted) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-stone-200 p-8 text-center">
          <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center bg-emerald-100 text-emerald-600">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          </div>
          <h1 className="text-xl font-bold text-stone-800 mt-4">Report already submitted</h1>
          <p className="text-stone-600 mt-2">Our team is reviewing the report for job {summary.linkedJob.reference}.</p>
        </div>
      </div>
    );
  }
  // A partner-typed token where the assignment doesn't match anymore (job
  // reassigned to someone else, or job not yet created) → explicit message.
  if (token && summary?.tokenKind === "partner_report" && !summary.linkedJob) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-stone-200 p-8 text-center">
          <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center bg-amber-100 text-amber-600">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376C1.83 17.624 2.91 19.5 4.645 19.5h14.71c1.736 0 2.815-1.876 1.948-3.374L13.948 3.376c-.867-1.5-3.031-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12V15.75Z" /></svg>
          </div>
          <h1 className="text-xl font-bold text-stone-800 mt-4">Link no longer valid</h1>
          <p className="text-stone-600 mt-2">This report link is no longer linked to an active assignment. Please contact the office for an updated link.</p>
        </div>
      </div>
    );
  }
  // Defensive: any partner-typed token that didn't hit a more specific
  // branch above should NOT render the customer accept/reject view by
  // accident. Treat it as a transient/invalid state and surface that.
  if (token && summary && summary.tokenKind && summary.tokenKind !== "customer") {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-stone-200 p-8 text-center">
          <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center bg-amber-100 text-amber-600">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376C1.83 17.624 2.91 19.5 4.645 19.5h14.71c1.736 0 2.815-1.876 1.948-3.374L13.948 3.376c-.867-1.5-3.031-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12V15.75Z" /></svg>
          </div>
          <h1 className="text-xl font-bold text-stone-800 mt-4">Link state unclear</h1>
          <p className="text-stone-600 mt-2">
            We couldn&apos;t determine what this link should show. Please contact the office for an updated link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center p-6">
      <div className="max-w-lg w-full max-h-[min(100vh-3rem,900px)] flex flex-col overflow-hidden rounded-2xl shadow-lg border border-stone-200 bg-white">
        <div className="flex-1 overflow-y-auto p-8">
          {loadingInfo ? (
            <p className="text-sm text-stone-500 text-center py-6">Loading quote details…</p>
          ) : infoError ? (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{infoError}</p>
          ) : summary ? (
            <div className="mb-6 rounded-xl border border-stone-200 bg-stone-50 p-4 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Your quotation</p>
              <div>
                <p className="text-[11px] text-stone-500">Reference</p>
                <p className="text-sm font-semibold text-stone-900">{summary.reference}</p>
              </div>
              <div>
                <p className="text-[11px] text-stone-500">Prepared for</p>
                <p className="text-sm text-stone-800">{summary.clientName}</p>
              </div>
              <div>
                <p className="text-[11px] text-stone-500">Job / service</p>
                <p className="text-base font-semibold text-stone-900">{summary.title}</p>
              </div>
              {summary.propertyAddress ? (
                <div>
                  <p className="text-[11px] text-stone-500">Property / address</p>
                  <p className="text-sm text-stone-800">{summary.propertyAddress}</p>
                </div>
              ) : null}
              {summary.lineItems.length > 0 ? (
                <div>
                  <p className="text-[11px] font-medium text-stone-500 mb-2">Line items</p>
                  <ul className="space-y-2 text-sm">
                    {summary.lineItems.map((li, i) => (
                      <li key={i} className="flex justify-between gap-3 border-b border-stone-100 pb-2 last:border-0 last:pb-0">
                        <span className="text-stone-800 flex-1">{li.description || "Item"}</span>
                        <span className="text-stone-600 tabular-nums shrink-0">{formatMoney(li.total)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {summary.scope?.trim() ? (
                <div>
                  <p className="text-[11px] font-medium text-stone-500 mb-1">Scope of work</p>
                  <p className="text-sm text-stone-700 whitespace-pre-wrap">{summary.scope.trim()}</p>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-4 pt-2 border-t border-stone-200">
                {(summary.startDateOption1 || summary.startDateOption2) && (
                  <div>
                    <p className="text-[11px] text-stone-500">Proposed start dates</p>
                    <p className="text-sm text-stone-800">
                      {[summary.startDateOption1, summary.startDateOption2].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-[11px] text-stone-500">Deposit required</p>
                  <p className="text-sm font-medium text-stone-900">{formatMoney(summary.depositRequired)}</p>
                </div>
              </div>
              <div className="flex justify-between items-baseline pt-2 border-t border-stone-200">
                <span className="text-sm font-semibold text-stone-800">Total</span>
                <span className="text-lg font-bold text-emerald-800">{formatMoney(summary.totalValue)}</span>
              </div>
            </div>
          ) : null}

          <h1 className="text-xl font-bold text-stone-800">
            {isAccept ? "Accept this quote?" : "Reject this quote?"}
          </h1>
          <p className="text-stone-600 mt-1">
            {isAccept
              ? "Confirm that you accept the quotation below. We will be in touch with next steps."
              : "If you would like to decline, you can optionally tell us why below."}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {!isAccept && (
              <div>
                <label htmlFor="reason" className="block text-sm font-medium text-stone-700 mb-1.5">Reason for declining (optional)</label>
                <textarea
                  id="reason"
                  rows={4}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  placeholder="e.g. Going with another provider, budget changed, timeline no longer works..."
                />
              </div>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={submitting}
                className={`flex-1 py-3 px-4 rounded-xl font-semibold text-white transition-colors ${isAccept ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"} disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {submitting ? "Sending..." : isAccept ? "Accept quote" : "Reject quote"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function QuoteRespondPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-stone-100 flex items-center justify-center">
        <div className="text-stone-500">Loading...</div>
      </div>
    }>
      <QuoteRespondContent />
    </Suspense>
  );
}
