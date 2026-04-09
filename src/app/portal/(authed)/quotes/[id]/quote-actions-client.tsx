"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";

interface QuoteActionsClientProps {
  quoteId:   string;
  reference: string;
}

export function QuoteActionsClient({ quoteId, reference }: QuoteActionsClientProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState<"accept" | "reject" | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [reason,     setReason]     = useState("");

  async function handleAccept() {
    setError(null);
    setSubmitting("accept");
    try {
      const res = await fetch(`/api/portal/quotes/${quoteId}/respond`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "accept" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "We could not process your acceptance.");
        setSubmitting(null);
        return;
      }
      // If a Stripe payment link came back, open it in a new tab so the
      // user can pay the deposit immediately.
      if (typeof json.paymentLinkUrl === "string" && json.paymentLinkUrl) {
        window.open(json.paymentLinkUrl, "_blank", "noopener,noreferrer");
      }
      router.push("/portal/jobs");
      router.refresh();
    } catch (err) {
      console.error("[portal/quotes/respond] accept error:", err);
      setError("We could not process your acceptance. Please try again.");
      setSubmitting(null);
    }
  }

  async function handleReject() {
    setError(null);
    setSubmitting("reject");
    try {
      const res = await fetch(`/api/portal/quotes/${quoteId}/respond`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "reject", rejectionReason: reason.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "We could not record your decision.");
        setSubmitting(null);
        return;
      }
      router.push("/portal/quotes");
      router.refresh();
    } catch (err) {
      console.error("[portal/quotes/respond] reject error:", err);
      setError("We could not record your decision. Please try again.");
      setSubmitting(null);
    }
  }

  return (
    <div>
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {showReject ? (
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Reason <span className="text-slate-400 normal-case font-normal">(optional)</span>
          </label>
          <textarea
            className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent resize-none"
            rows={3}
            placeholder={`Tell us why you're declining quote ${reference} (optional)`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting !== null}
          />
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => { setShowReject(false); setReason(""); }}
              className="px-5 py-2.5 rounded-xl text-slate-600 font-semibold text-sm hover:bg-slate-50"
              disabled={submitting !== null}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={submitting !== null}
              className="px-5 py-2.5 rounded-xl bg-red-600 text-white font-bold text-sm hover:bg-red-700 transition-colors disabled:opacity-60"
            >
              {submitting === "reject" ? "Submitting..." : "Confirm decline"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setShowReject(true)}
            disabled={submitting !== null}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border-2 border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors disabled:opacity-60"
          >
            <X className="w-4 h-4" />
            Decline
          </button>
          <button
            type="button"
            onClick={handleAccept}
            disabled={submitting !== null}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 transition-colors disabled:opacity-60"
          >
            <Check className="w-4 h-4" />
            {submitting === "accept" ? "Processing..." : "Accept quote"}
          </button>
        </div>
      )}
    </div>
  );
}
