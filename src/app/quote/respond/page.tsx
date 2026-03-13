"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function QuoteRespondContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const action = searchParams.get("action");

  const [rejectionReason, setRejectionReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!token || !action) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-stone-200 p-8 text-center">
          <h1 className="text-xl font-bold text-stone-800">Invalid link</h1>
          <p className="text-stone-600 mt-2">This quote response link is missing parameters. Please use the link from your email.</p>
        </div>
      </div>
    );
  }

  if (action !== "accept" && action !== "reject") {
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

  return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-stone-200 p-8">
        <h1 className="text-xl font-bold text-stone-800">
          {isAccept ? "Accept this quote?" : "Reject this quote?"}
        </h1>
        <p className="text-stone-600 mt-1">
          {isAccept
            ? "Confirm that you accept the quotation. We will be in touch with next steps."
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
