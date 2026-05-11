"use client";

import { useState } from "react";

interface PublicBidFormProps {
  token:           string;
  quoteReference:  string;
  quoteTitle:      string;
  propertyAddress: string | null;
  scope:           string | null;
  partnerName:     string | null;
  existingBid:     { amount: number; jobType: "fixed" | "hourly"; notes: string | null } | null;
  onSubmitted:     (msg: string) => void;
}

export default function PublicBidForm({
  token,
  quoteReference,
  quoteTitle,
  propertyAddress,
  scope,
  partnerName,
  existingBid,
  onSubmitted,
}: PublicBidFormProps) {
  const [bidAmount, setBidAmount] = useState<string>(
    existingBid ? String(existingBid.amount) : "",
  );
  const [jobType, setJobType] = useState<"fixed" | "hourly">(existingBid?.jobType ?? "fixed");
  const [notes, setNotes] = useState<string>(existingBid?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const n = Number(bidAmount);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter a valid bid amount greater than zero.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/quotes/submit-bid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          bidAmount: n,
          jobType,
          notes: notes.trim() || null,
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? "Could not submit the bid.");
        return;
      }
      onSubmitted(existingBid ? "Bid updated. Thank you." : "Bid submitted. Thank you.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="space-y-1 pb-2 border-b border-[#E4E4E8]">
        <p className="text-[11px] uppercase tracking-wide text-[#6B6B70]">Submit bid</p>
        <h2 className="text-[20px] font-semibold text-[#020040]">{quoteTitle}</h2>
        <p className="text-[12px] text-[#6B6B70]">
          {propertyAddress ?? ""} · {quoteReference}
        </p>
        {partnerName ? (
          <p className="text-[11px] text-[#6B6B70]">
            Bidding as <strong>{partnerName}</strong>
          </p>
        ) : null}
      </header>

      {scope?.trim() ? (
        <section className="rounded-md bg-[#F7F7FB] border border-[#E4E4EC] p-3">
          <p className="text-[10px] uppercase tracking-wide text-[#6B6B70] mb-1">Scope</p>
          <p className="text-[13px] text-[#3A3A55] whitespace-pre-wrap">{scope.trim()}</p>
        </section>
      ) : null}

      {existingBid ? (
        <div className="rounded-md bg-[#FFF8F3] border border-[#F5CFB8] px-3 py-2 text-[12px] text-[#7A3D00]">
          You previously bid £{existingBid.amount.toFixed(2)} ({existingBid.jobType}). You can update it below.
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="space-y-1">
          <label className="block text-[13px] font-medium text-[#020040]">Bid amount (GBP)</label>
          <input
            type="number"
            min={0}
            step={0.01}
            value={bidAmount}
            onChange={(e) => setBidAmount(e.target.value)}
            placeholder="e.g. 850"
            className="w-full rounded-md border border-[#D8D8DD] px-3 py-2 text-[14px]"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-[13px] font-medium text-[#020040]">Pricing type</label>
          <div className="flex gap-2">
            {(["fixed", "hourly"] as const).map((jt) => (
              <button
                key={jt}
                type="button"
                onClick={() => setJobType(jt)}
                className="px-3 py-1.5 rounded-md text-[13px] font-medium border"
                style={
                  jobType === jt
                    ? { background: "#020040", color: "#fff", borderColor: "#020040" }
                    : { background: "#fff", color: "#020040", borderColor: "#D8D8DD" }
                }
              >
                {jt === "fixed" ? "Fixed price" : "Hourly rate"}
              </button>
            ))}
          </div>
          {jobType === "hourly" ? (
            <p className="text-[11px] text-[#6B6B70]">
              Enter your hourly rate. The office decides the bundle.
            </p>
          ) : (
            <p className="text-[11px] text-[#6B6B70]">
              Enter the all-in fixed price for the scope above.
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label className="block text-[13px] font-medium text-[#020040]">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Anything the office should know — availability, scope assumptions, materials, etc."
            className="w-full rounded-md border border-[#D8D8DD] px-3 py-2 text-[14px]"
          />
        </div>
      </section>

      {error ? (
        <div className="rounded-md bg-[#FFF1EB] border border-[#F5CFB8] p-3 text-[12px] text-[#7A3D00]">
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={submitting}
        className="w-full inline-flex items-center justify-center gap-2 rounded-md px-4 py-3 text-[14px] font-semibold disabled:opacity-50"
        style={{ background: "#020040", color: "#fff" }}
      >
        {submitting ? "Submitting…" : existingBid ? "Update bid" : "Submit bid"}
      </button>
    </div>
  );
}
