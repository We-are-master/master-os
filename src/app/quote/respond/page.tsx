"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import PublicReportForm from "./public-report-form";
import PublicBidForm from "./public-bid-form";
import PublicPhotoGallery from "./public-photo-gallery";
import {
  FIXFY_BORDER,
  FIXFY_MUTED,
  FIXFY_NAVY,
  FIXFY_ORANGE,
  FixfyPublicHeader,
  FixfyPublicLoading,
  FixfyPublicScrollBody,
  FixfyPublicShell,
  FixfyPublicStatus,
} from "./public-fixfy-shell";
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
  existingBid: {
    amount: number;
    jobType: "fixed" | "hourly";
    notes: string | null;
    payload: Record<string, unknown> | null;
  } | null;
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
  /** Datas do parceiro que o cliente pode escolher no aceite. */
  startDateChoices?: { value: string; label: string | null }[];
  status: string;
  lineItems: { description: string; quantity: number; unitPrice: number; total: number }[];
  /** Fotos do site (service_request) — galeria com lightbox nas duas visões. */
  photoUrls?: string[];
  /** Distinguishes the three token surfaces (customer accept/reject, partner bid, partner report). */
  tokenKind?: "customer" | "partner_bid" | "partner_report";
  linkedJob?: LinkedJob | null;
  /** Por que o report não abre (15/10/2026): cancelado, outro parceiro, já concluído. */
  reportBlock?: { motivo: string; mensagem: string } | null;
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
  const [dataEscolhida, setDataEscolhida] = useState<string | null>(null);
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
          // ⚠️  Carry tokenKind / linkedJob / bidContext through — the page
          // branches on these to decide whether to render the customer
          // accept/reject view, the partner bid form, or the partner
          // report form. Dropping them here made every partner link fall
          // through to the customer view.
          setSummary({
            reference: data.reference ?? "",
            title: data.title ?? "",
            clientName: data.clientName ?? "",
            propertyAddress: data.propertyAddress ?? null,
            scope: data.scope ?? null,
            serviceType: data.serviceType ?? null,
            totalValue: data.totalValue ?? 0,
            depositRequired: data.depositRequired ?? 0,
            startDateOption1: data.startDateOption1 ?? null,
            startDateOption2: data.startDateOption2 ?? null,
            startDateChoices: data.startDateChoices ?? [],
            status: data.status ?? "",
            lineItems: data.lineItems ?? [],
            photoUrls: data.photoUrls ?? [],
            tokenKind: data.tokenKind ?? "customer",
            linkedJob: data.linkedJob ?? null,
            reportBlock: data.reportBlock ?? null,
            bidContext: data.bidContext ?? null,
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
      <FixfyPublicStatus
        variant="error"
        title="Invalid link"
        message="This link is missing its token. Please use the link from your email."
      />
    );
  }

  if (token === "invalid" || token === "expired") {
    const motivo = searchParams.get("motivo");
    return (
      <FixfyPublicStatus
        variant="warning"
        title={motivo === "sem_parceiro" ? "This job has no partner right now" : motivo === "job_removido" ? "This job was removed" : "Invalid or expired link"}
        message={
          motivo === "sem_parceiro"
            ? "Nobody is assigned to this job at the moment, so there is no report to send. Contact the Fixfy team if you did this job."
            : motivo === "job_removido"
              ? "This job is no longer in our system. Contact the Fixfy team if you need help."
              : token === "expired"
                ? "This link has expired. Contact the office for a fresh link."
                : "This link is not valid. Contact the office if you need a new job or report link."
        }
      />
    );
  }

  if (loadingInfo) {
    return <FixfyPublicLoading message="Loading…" />;
  }

  // `action` is only meaningful for customer accept/reject tokens (legacy
  // emailed CTAs). Partner bid + partner report tokens land here with no
  // `action` query param — the page below picks the right form by
  // `summary.tokenKind`. Skip the `action` shape validation in those cases.
  const isCustomerActionToken = summary?.tokenKind === "customer";

  if (isCustomerActionToken && action && action !== "accept" && action !== "reject") {
    return (
      <FixfyPublicStatus
        variant="warning"
        title="Invalid action"
        message="Please use the Accept or Reject button from your email."
      />
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
          ...(action === "accept" && (dataEscolhida ?? summary?.startDateChoices?.[0]?.value)
            ? { startDate: dataEscolhida ?? summary?.startDateChoices?.[0]?.value }
            : {}),
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
      <FixfyPublicStatus
        variant={result.success ? "success" : "warning"}
        title="Thank you"
        message={result.message}
      />
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
      <FixfyPublicShell size="lg">
        <FixfyPublicHeader eyebrow="Partner bid" />
        <FixfyPublicScrollBody>
          <div className="px-5 py-6 sm:px-8">
            <PublicBidForm
              token={token}
              quoteReference={summary.reference}
              quoteTitle={summary.title}
              propertyAddress={summary.propertyAddress}
              scope={summary.scope}
              photoUrls={summary.photoUrls ?? []}
              partnerName={summary.bidContext.partnerName}
              existingBid={summary.bidContext.existingBid}
              onSubmitted={(msg) => setResult({ success: true, message: msg })}
            />
          </div>
        </FixfyPublicScrollBody>
      </FixfyPublicShell>
    );
  }
  if (token && summary?.tokenKind === "partner_bid" && summary.status !== "bidding") {
    return (
      <FixfyPublicStatus
        variant="info"
        title="Bidding closed"
        message="This quote is no longer accepting bids."
        badge={summary.reference}
      />
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
      <FixfyPublicShell size="lg">
        <FixfyPublicScrollBody>
          <PublicReportForm
            token={token}
            jobReference={job.reference}
            jobTitle={job.title ?? summary.title}
            propertyAddress={job.propertyAddress ?? summary.propertyAddress ?? ""}
            serviceType={job.serviceType ?? summary.serviceType ?? null}
            template={pickReportTemplate({
              serviceType: job.serviceType ?? summary.serviceType ?? null,
              title: job.title ?? summary.title,
              categorySlug: (job as { categorySlug?: string | null }).categorySlug ?? null,
            })}
            onSubmitted={() =>
              setResult({
                success: true,
                message: "Report submitted. Our team will review it shortly.",
              })
            }
          />
        </FixfyPublicScrollBody>
      </FixfyPublicShell>
    );
  }
  if (token && summary?.linkedJob?.finalReportSubmitted && summary.linkedJob.startReportSubmitted) {
    return (
      <FixfyPublicStatus
        variant="success"
        title="Report already submitted"
        message="Our team is reviewing your report. We'll be in touch if anything else is needed."
        badge={summary.linkedJob.reference}
      />
    );
  }
  // A partner-typed token where the assignment doesn't match anymore (job
  // reassigned to someone else, or job not yet created) → explicit message.
  if (token && summary?.tokenKind === "partner_report" && !summary.linkedJob) {
    const b = summary.reportBlock;
    const titulo =
      b?.motivo === "cancelado" ? "This job was cancelled" : b?.motivo === "concluido" ? "This job is closed" : b?.motivo === "outro_parceiro" ? "This job is no longer yours" : "Link no longer valid";
    return (
      <FixfyPublicStatus
        variant={b?.motivo === "concluido" ? "success" : "warning"}
        title={titulo}
        message={b?.mensagem ?? "This report link is no longer linked to an active assignment. Please contact the office for an updated link."}
      />
    );
  }
  // Defensive: any partner-typed token that didn't hit a more specific
  // branch above should NOT render the customer accept/reject view by
  // accident. Treat it as a transient/invalid state and surface that.
  if (token && summary && summary.tokenKind && summary.tokenKind !== "customer") {
    return (
      <FixfyPublicStatus
        variant="warning"
        title="Link state unclear"
        message="We couldn't determine what this link should show. Please contact the office for an updated link."
      />
    );
  }

  if (infoError && !summary) {
    return (
      <FixfyPublicStatus
        variant="warning"
        title="Invalid or expired link"
        message={infoError}
      />
    );
  }

  return (
    <FixfyPublicShell size="lg">
      <FixfyPublicHeader eyebrow="Your quotation" />
      <FixfyPublicScrollBody>
        <div className="space-y-5 px-5 py-6 sm:px-8">
          {summary ? (
            <div
              className="space-y-3 rounded-xl border p-4"
              style={{ borderColor: FIXFY_BORDER, background: "#F7F7FB" }}
            >
              <p className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: FIXFY_ORANGE }}>
                Quote summary
              </p>
              <div>
                <p className="text-[11px]" style={{ color: FIXFY_MUTED }}>Reference</p>
                <p className="text-sm font-semibold" style={{ color: FIXFY_NAVY }}>{summary.reference}</p>
              </div>
              <div>
                <p className="text-[11px]" style={{ color: FIXFY_MUTED }}>Prepared for</p>
                <p className="text-sm" style={{ color: FIXFY_NAVY }}>{summary.clientName}</p>
              </div>
              <div>
                <p className="text-[11px]" style={{ color: FIXFY_MUTED }}>Job / service</p>
                <p className="text-base font-semibold" style={{ color: FIXFY_NAVY }}>{summary.title}</p>
              </div>
              {summary.propertyAddress ? (
                <div>
                  <p className="text-[11px]" style={{ color: FIXFY_MUTED }}>Property / address</p>
                  <p className="text-sm" style={{ color: FIXFY_NAVY }}>{summary.propertyAddress}</p>
                </div>
              ) : null}
              {summary.lineItems.length > 0 ? (
                <div>
                  <p className="mb-2 text-[11px] font-medium" style={{ color: FIXFY_MUTED }}>Line items</p>
                  <ul className="space-y-2 text-sm">
                    {summary.lineItems.map((li, i) => (
                      <li
                        key={i}
                        className="flex justify-between gap-3 border-b pb-2 last:border-0 last:pb-0"
                        style={{ borderColor: FIXFY_BORDER }}
                      >
                        <span className="flex-1" style={{ color: FIXFY_NAVY }}>{li.description || "Item"}</span>
                        <span className="shrink-0 tabular-nums" style={{ color: FIXFY_MUTED }}>{formatMoney(li.total)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {summary.scope?.trim() ? (
                <div>
                  <p className="mb-1 text-[11px] font-medium" style={{ color: FIXFY_MUTED }}>Scope of work</p>
                  <p className="whitespace-pre-wrap text-sm" style={{ color: FIXFY_NAVY }}>{summary.scope.trim()}</p>
                </div>
              ) : null}
              {(summary.photoUrls?.length ?? 0) > 0 ? (
                <PublicPhotoGallery urls={summary.photoUrls!} />
              ) : null}
              <div className="flex flex-wrap gap-4 border-t pt-2" style={{ borderColor: FIXFY_BORDER }}>
                {(summary.startDateOption1 || summary.startDateOption2) && (
                  <div>
                    <p className="text-[11px]" style={{ color: FIXFY_MUTED }}>Proposed start dates</p>
                    <p className="text-sm" style={{ color: FIXFY_NAVY }}>
                      {[summary.startDateOption1, summary.startDateOption2].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-[11px]" style={{ color: FIXFY_MUTED }}>Deposit required</p>
                  <p className="text-sm font-medium" style={{ color: FIXFY_NAVY }}>{formatMoney(summary.depositRequired)}</p>
                </div>
              </div>
              <div className="flex items-baseline justify-between border-t pt-2" style={{ borderColor: FIXFY_BORDER }}>
                <span className="text-sm font-semibold" style={{ color: FIXFY_NAVY }}>Total</span>
                <span className="text-lg font-bold" style={{ color: "#0F6E56" }}>{formatMoney(summary.totalValue)}</span>
              </div>
            </div>
          ) : null}

          <h1 className="text-[20px] font-bold" style={{ color: FIXFY_NAVY }}>
            {isAccept ? "Accept this quote?" : "Reject this quote?"}
          </h1>
          <p className="mt-1 text-[14px]" style={{ color: FIXFY_MUTED }}>
            {isAccept
              ? "Confirm that you accept the quotation below. We will be in touch with next steps."
              : "If you would like to decline, you can optionally tell us why below."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isAccept && summary?.startDateChoices && summary.startDateChoices.length > 0 ? (
              <fieldset className="space-y-2">
                <legend className="mb-1.5 text-sm font-semibold" style={{ color: FIXFY_NAVY }}>
                  Choose a start date
                </legend>
                {[...(summary?.startDateChoices ?? []), { value: "none", label: "None of these dates work for me" }].map((o, i) => {
                  const marcada = (dataEscolhida ?? summary?.startDateChoices?.[0]?.value) === o.value;
                  return (
                    <label
                      key={o.value}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm"
                      style={{ borderColor: marcada ? FIXFY_NAVY : FIXFY_BORDER, color: FIXFY_NAVY }}
                    >
                      <input type="radio" name="startDate" value={o.value} checked={marcada} onChange={() => setDataEscolhida(o.value)} />
                      {o.value === "none" ? o.label : o.label ?? o.value}
                      {i === 0 && o.value !== "none" ? <span className="text-xs" style={{ color: FIXFY_MUTED }}>Earliest</span> : null}
                    </label>
                  );
                })}
                {(dataEscolhida ?? "") === "none" ? (
                  <p className="text-xs" style={{ color: FIXFY_MUTED }}>
                    No problem. Accept the quote and we&apos;ll contact you to agree a day.
                  </p>
                ) : null}
              </fieldset>
            ) : null}
            {!isAccept && (
              <div>
                <label htmlFor="reason" className="mb-1.5 block text-sm font-semibold" style={{ color: FIXFY_NAVY }}>
                  Reason for declining (optional)
                </label>
                <textarea
                  id="reason"
                  rows={4}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2.5 text-sm focus:border-text-primary focus:outline-none focus:ring-2 focus:ring-text-primary/20"
                  style={{ borderColor: FIXFY_BORDER, color: FIXFY_NAVY }}
                  placeholder="e.g. Going with another provider, budget changed, timeline no longer works..."
                />
              </div>
            )}
            {error ? (
              <p className="rounded-lg border px-3 py-2 text-sm" style={{ background: "#FFF1EB", borderColor: "#F5CFB8", color: "#7A3D00" }}>
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl px-4 py-3.5 text-[15px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              style={
                isAccept
                  ? { background: "linear-gradient(135deg,#ED4B00 0%,#FF7A29 100%)" }
                  : { background: FIXFY_NAVY }
              }
            >
              {submitting ? "Sending…" : isAccept ? "Accept quote" : "Reject quote"}
            </button>
          </form>
        </div>
      </FixfyPublicScrollBody>
    </FixfyPublicShell>
  );
}

export default function QuoteRespondPage() {
  return (
    <Suspense fallback={<FixfyPublicLoading />}>
      <QuoteRespondContent />
    </Suspense>
  );
}
