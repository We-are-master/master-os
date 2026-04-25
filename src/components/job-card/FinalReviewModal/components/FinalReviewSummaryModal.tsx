"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import type { FinalReviewSummarySnapshot } from "../types";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  summary: FinalReviewSummarySnapshot;
};

function Row({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#6B6B70" }}>
        {label}
      </p>
      <p className={`text-[13px] font-medium break-words ${valueClassName ?? ""}`} style={{ color: "#020040" }}>
        {value}
      </p>
    </div>
  );
}

export function FinalReviewSummaryModal({ isOpen, onClose, summary }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const emailLine = summary.emailLoading
    ? "Loading…"
    : summary.emailTo?.trim()
      ? summary.emailTo
      : "— (add billing / client email)";

  const accountLine = summary.emailLoading
    ? "Loading…"
    : summary.linkedAccountName?.trim()
      ? summary.linkedAccountName
      : "— (no corporate account linked)";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="final-review-summary-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px] cursor-default border-none"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-[min(100%,400px)] rounded-[14px] bg-white shadow-xl border border-zinc-200/90 max-h-[min(85dvh,480px)] overflow-y-auto"
        style={{ boxShadow: "0 20px 50px -20px rgba(2,0,64,0.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between gap-2 px-4 py-3 border-b"
          style={{ borderColor: "var(--color-border-tertiary, #E4E4E7)" }}
        >
          <h2 id="final-review-summary-title" className="text-[14px] font-semibold" style={{ color: "#020040" }}>
            Check before you complete
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-zinc-100 border-none bg-transparent cursor-pointer shrink-0"
            style={{ color: "#6B6B70" }}
            aria-label="Close summary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-3 space-y-3.5">
          <Row label="Account" value={accountLine} />
          <Row label="Invoice to" value={summary.invoiceTo} />
          <Row label="Email (completion send)" value={emailLine} />
          <Row label="Final amount (billable)" value={summary.finalAmountLabel} />
          <div className="space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#6B6B70" }}>
              Reports
            </p>
            <p
              className="text-[13px] font-medium"
              style={{ color: summary.reportsOk ? "#0F6E56" : "#B45309" }}
            >
              {summary.reportsOk ? "OK — " : "Check — "}
              {summary.reportsDetail}
            </p>
          </div>
        </div>
        <div className="px-4 pb-4 pt-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full text-[13px] font-medium py-2.5 rounded-lg text-white border-none cursor-pointer"
            style={{ background: "#020040" }}
          >
            Back to review
          </button>
        </div>
      </div>
    </div>
  );
}
