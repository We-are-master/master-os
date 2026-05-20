"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type OfferSummary = {
  reference:               string;
  title:                   string;
  propertyAddress:         string | null;
  scope:                   string | null;
  partnerName:             string | null;
  arrivalStart:            string | null;
  arrivalEnd:              string | null;
  partnerCost:             number;
  status:                  string;
  partnerOfferResponse:    "accepted" | "declined" | null;
  partnerOfferRespondedAt: string | null;
  stale:                   boolean;
  closed:                  boolean;
};

function PartnerOfferContent() {
  const sp = useSearchParams();
  const token = sp.get("token");

  const [summary, setSummary] = useState<OfferSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState<"accept" | "decline" | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{ action: "accept" | "decline" } | null>(null);

  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetch(`/api/jobs/offer-info?token=${encodeURIComponent(token)}`)
      .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) {
          setLoadError((body as { error?: string })?.error ?? "Could not load offer.");
          return;
        }
        setSummary(body as OfferSummary);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Network error.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [token]);

  const submit = async (action: "accept" | "decline") => {
    if (!token) return;
    setSubmitError(null);
    setSubmitting(action);
    try {
      const res = await fetch("/api/jobs/respond-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          action,
          reason: action === "decline" ? declineReason.trim() || null : null,
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setSubmitError(body?.error ?? "Could not save your response.");
        return;
      }
      setResult({ action });
    } finally {
      setSubmitting(null);
    }
  };

  if (!token) {
    return (
      <Card>
        <h1 className="text-xl font-bold text-stone-800">Invalid link</h1>
        <p className="text-stone-600 mt-2">This link is missing its token. Please use the link from your email.</p>
      </Card>
    );
  }

  if (loading) {
    return <Card><p className="text-sm text-stone-500 text-center py-6">Loading offer…</p></Card>;
  }

  if (loadError) {
    return (
      <Card>
        <h1 className="text-xl font-bold text-stone-800">Offer unavailable</h1>
        <p className="text-stone-600 mt-2">{loadError}</p>
      </Card>
    );
  }

  if (!summary) {
    return (
      <Card>
        <h1 className="text-xl font-bold text-stone-800">Offer not found</h1>
      </Card>
    );
  }

  if (result) {
    return (
      <Card>
        <div className={`w-14 h-14 rounded-full mx-auto flex items-center justify-center ${result.action === "accept" ? "bg-emerald-100 text-emerald-600" : "bg-stone-200 text-stone-600"}`}>
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {result.action === "accept" ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            )}
          </svg>
        </div>
        <h1 className="text-xl font-bold text-stone-800 mt-4 text-center">
          {result.action === "accept" ? "Job accepted — thanks!" : "Job declined"}
        </h1>
        <p className="text-stone-600 mt-2 text-center">
          {result.action === "accept"
            ? "We've told the office. You'll get the full briefing closer to the date."
            : "Thanks for letting us know — the office has been notified and will reassign."}
        </p>
      </Card>
    );
  }

  if (summary.closed) {
    return (
      <Card>
        <h1 className="text-xl font-bold text-stone-800">Offer closed</h1>
        <p className="text-stone-600 mt-2">This job is {summary.status}. No further response is needed.</p>
      </Card>
    );
  }

  if (summary.stale) {
    return (
      <Card>
        <h1 className="text-xl font-bold text-stone-800">Link no longer valid</h1>
        <p className="text-stone-600 mt-2">This offer was reassigned. Please contact the office for an updated link.</p>
      </Card>
    );
  }

  // Already responded — show summary, allow flipping the answer.
  if (summary.partnerOfferResponse) {
    return (
      <Card>
        <p className="text-[11px] uppercase tracking-wide text-stone-500">Job offer · {summary.reference}</p>
        <h1 className="text-xl font-bold text-stone-800 mt-1">{summary.title}</h1>
        <p className="text-sm text-stone-600 mt-1">{summary.propertyAddress}</p>
        <div className="mt-4 rounded-md bg-stone-50 border border-stone-200 px-3 py-2 text-sm">
          You already <strong>{summary.partnerOfferResponse}</strong> this job
          {summary.partnerOfferRespondedAt ? ` on ${new Date(summary.partnerOfferRespondedAt).toLocaleString("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}.
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void submit("accept")}
            disabled={submitting !== null || summary.partnerOfferResponse === "accepted"}
            className="rounded-md px-4 py-2.5 font-semibold text-sm disabled:opacity-40"
            style={{ background: "#0F6E56", color: "#fff" }}
          >
            {summary.partnerOfferResponse === "accepted" ? "Accepted ✓" : "Switch to Accept"}
          </button>
          <button
            type="button"
            onClick={() => setDeclining(true)}
            disabled={submitting !== null || summary.partnerOfferResponse === "declined"}
            className="rounded-md px-4 py-2.5 font-semibold text-sm disabled:opacity-40"
            style={{ background: "#fff", color: "#7A3D00", border: "1px solid #F5CFB8" }}
          >
            {summary.partnerOfferResponse === "declined" ? "Declined" : "Switch to Decline"}
          </button>
        </div>
        {declining ? (
          <DeclineBox
            value={declineReason}
            onChange={setDeclineReason}
            onSubmit={() => void submit("decline")}
            onCancel={() => setDeclining(false)}
            submitting={submitting === "decline"}
          />
        ) : null}
        {submitError ? (
          <div className="mt-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
            {submitError}
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <Card>
      <p className="text-[11px] uppercase tracking-wide text-stone-500">Job offer · {summary.reference}</p>
      <h1 className="text-xl font-bold text-stone-800 mt-1">{summary.title}</h1>
      {summary.partnerName ? (
        <p className="text-[11px] text-stone-500 mt-1">For: {summary.partnerName}</p>
      ) : null}

      <div className="mt-4 space-y-3">
        {summary.propertyAddress ? (
          <Row label="Property" value={summary.propertyAddress} />
        ) : null}
        {(summary.arrivalStart || summary.arrivalEnd) ? (
          <Row
            label="Arrival window"
            value={`${summary.arrivalStart ?? "—"}${summary.arrivalEnd ? ` – ${summary.arrivalEnd}` : ""}`}
          />
        ) : null}
        <Row label="Partner payout" value={`£${summary.partnerCost.toFixed(2)}`} />
        {summary.scope?.trim() ? (
          <div className="rounded-md bg-stone-50 border border-stone-200 p-3">
            <p className="text-[10px] uppercase tracking-wide text-stone-500 mb-1">Scope</p>
            <p className="text-[13px] text-stone-700 whitespace-pre-wrap">{summary.scope.trim()}</p>
          </div>
        ) : null}
      </div>

      {!declining ? (
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void submit("accept")}
            disabled={submitting !== null}
            className="rounded-md px-4 py-3 font-semibold text-sm disabled:opacity-40"
            style={{ background: "#0F6E56", color: "#fff" }}
          >
            {submitting === "accept" ? "Saving…" : "Accept job"}
          </button>
          <button
            type="button"
            onClick={() => setDeclining(true)}
            disabled={submitting !== null}
            className="rounded-md px-4 py-3 font-semibold text-sm disabled:opacity-40"
            style={{ background: "#fff", color: "#7A3D00", border: "1px solid #F5CFB8" }}
          >
            Decline
          </button>
        </div>
      ) : (
        <DeclineBox
          value={declineReason}
          onChange={setDeclineReason}
          onSubmit={() => void submit("decline")}
          onCancel={() => setDeclining(false)}
          submitting={submitting === "decline"}
        />
      )}

      {submitError ? (
        <div className="mt-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
          {submitError}
        </div>
      ) : null}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-stone-200 p-6 sm:p-8">
        {children}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[11px] uppercase tracking-wide text-stone-500 w-28 shrink-0 mt-0.5">{label}</span>
      <span className="text-[13px] text-stone-700 flex-1">{value}</span>
    </div>
  );
}

function DeclineBox({
  value,
  onChange,
  onSubmit,
  onCancel,
  submitting,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  return (
    <div className="mt-4 rounded-md border border-stone-200 bg-stone-50 p-3 space-y-2">
      <label className="block text-[11px] uppercase tracking-wide text-stone-500">
        Reason for declining (optional)
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder="e.g. Not available on that date / out of region / …"
        className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-[13px]"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="rounded-md px-3 py-2 font-semibold text-sm disabled:opacity-40"
          style={{ background: "#7A3D00", color: "#fff" }}
        >
          {submitting ? "Sending…" : "Confirm decline"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-md px-3 py-2 text-sm"
          style={{ color: "#020040", border: "1px solid #D8D8DD" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function PartnerOfferPage() {
  return (
    <Suspense fallback={<Card><p className="text-sm text-stone-500 text-center py-6">Loading…</p></Card>}>
      <PartnerOfferContent />
    </Suspense>
  );
}
