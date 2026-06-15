"use client";

import { Check, Loader2, Mail, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  count: number;
  saving?: boolean;
  emailSending?: boolean;
  variant: "invoice" | "selfbill";
  /** When variant is selfbill — drives which bulk actions appear. */
  selfbillMode?: "drafts" | "pending" | "approved";
  onMarkPaid?: () => void;
  onClear: () => void;
  onEmail?: () => void;
  onCancel?: () => void;
  onApprove?: () => void;
  onApproveAndSend?: () => void;
  onMarkReadyToPay?: () => void;
  onUnapprove?: () => void;
};

export function BillingBulkBar({
  count,
  saving,
  emailSending,
  variant,
  selfbillMode,
  onMarkPaid,
  onClear,
  onEmail,
  onCancel,
  onApprove,
  onApproveAndSend,
  onMarkReadyToPay,
  onUnapprove,
}: Props) {
  if (count <= 0) return null;
  const busy = saving || emailSending;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-2xl border border-border-light bg-[#020040] px-3 py-2.5 shadow-xl sm:bottom-6 sm:max-w-[calc(100vw-2rem)] sm:gap-3 sm:px-5 sm:py-3">
      <span className="text-xs font-semibold tabular-nums text-white/80 sm:text-sm">{count} selected</span>
      <div className="hidden h-4 w-px bg-white/20 sm:block" />
      {variant === "invoice" && onMarkPaid ? (
        <button
          type="button"
          disabled={busy}
          onClick={onMarkPaid}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-emerald-600 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
          Mark as paid
        </button>
      ) : null}
      {variant === "selfbill" && selfbillMode === "drafts" && onMarkReadyToPay ? (
        <button
          type="button"
          disabled={busy}
          onClick={onMarkReadyToPay}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-emerald-600 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
          Ready to pay
        </button>
      ) : null}
      {variant === "selfbill" && selfbillMode === "pending" ? (
        <>
          {onApprove ? (
            <button
              type="button"
              disabled={busy}
              onClick={onApprove}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-emerald-600 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
              Approve
            </button>
          ) : null}
          {onApproveAndSend ? (
            <button
              type="button"
              disabled={busy}
              onClick={onApproveAndSend}
              className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20 disabled:opacity-60"
            >
              Approve &amp; Send
            </button>
          ) : null}
        </>
      ) : null}
      {variant === "selfbill" && selfbillMode === "approved" ? (
        <>
          {onUnapprove ? (
            <button
              type="button"
              disabled={busy}
              onClick={onUnapprove}
              className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              Unapprove
            </button>
          ) : null}
          {onEmail ? (
            <button
              type="button"
              disabled={busy}
              onClick={onEmail}
              className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20 disabled:opacity-60"
            >
              <Mail className="h-3.5 w-3.5" />
              Email
            </button>
          ) : null}
        </>
      ) : null}
      {variant === "selfbill" && onCancel ? (
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20 disabled:opacity-60"
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClear}
        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white/60 transition-colors hover:text-white"
      >
        Clear
      </button>
    </div>
  );
}

export function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "bad" | "info" | "warn" | "muted";
}) {
  const cls = {
    ok: "bg-emerald-50 text-emerald-800 border-emerald-200",
    bad: "bg-red-50 text-red-700 border-red-200",
    info: "bg-blue-50 text-blue-800 border-blue-200",
    warn: "bg-amber-50 text-amber-800 border-amber-200",
    muted: "bg-surface-hover text-text-secondary border-border-light",
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold", cls)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}
