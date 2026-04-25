"use client";

import { useState } from "react";
import { FileText, X } from "lucide-react";
import type { FinalReviewSummarySnapshot } from "../types";
import { FinalReviewSummaryModal } from "./FinalReviewSummaryModal";

type Props = {
  jobId: string;
  jobTitle: string;
  clientName: string;
  onClose: () => void;
  reviewSummary?: FinalReviewSummarySnapshot | null;
};

export function ModalHeader({ jobId, jobTitle, clientName, onClose, reviewSummary }: Props) {
  const [summaryOpen, setSummaryOpen] = useState(false);
  const initial = (clientName?.trim()?.[0] ?? "?").toUpperCase();

  return (
    <div
      className="flex items-start sm:items-center justify-between gap-2 px-4 sm:px-6 pt-4 sm:pt-5 pb-[14px] sm:pb-[18px]"
      style={{ borderBottom: "0.5px solid var(--color-border-tertiary, #E4E4E7)" }}
    >
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        <div
          className="w-8 h-8 sm:w-9 sm:h-9 rounded-[10px] flex items-center justify-center text-[12px] sm:text-[13px] font-medium text-white shrink-0"
          style={{ background: "#020040" }}
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <span className="text-[14px] sm:text-[15px] font-medium" style={{ color: "#020040" }}>
              Final review
            </span>
            <span
              className="text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-[2px] rounded-md font-medium"
              style={{ color: "#ED4B00", background: "#FFF1EB" }}
            >
              Awaiting approval
            </span>
          </div>
          <div className="text-[11px] sm:text-[12px] mt-0.5 sm:mt-[2px] leading-snug line-clamp-2" style={{ color: "#6B6B70" }}>
            {jobId} · {clientName} · {jobTitle}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0 self-start sm:self-center">
        {reviewSummary ? (
          <button
            type="button"
            onClick={() => setSummaryOpen(true)}
            className="inline-flex items-center gap-1 text-[11px] sm:text-[12px] font-medium px-2 sm:px-2.5 py-1.5 rounded-lg border transition-colors"
            style={{
              color: "#020040",
              borderColor: "#D4D4D8",
              background: "#FAFAFB",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "#F4F4F5";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "#FAFAFB";
            }}
          >
            <FileText className="h-3.5 w-3.5 opacity-80 shrink-0" />
            Summary
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="p-1 leading-none bg-transparent border-none cursor-pointer shrink-0"
          style={{ color: "#9A9AA0" }}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {reviewSummary && summaryOpen ? (
        <FinalReviewSummaryModal isOpen={summaryOpen} onClose={() => setSummaryOpen(false)} summary={reviewSummary} />
      ) : null}
    </div>
  );
}
