"use client";

import { Check, Loader2, Mail, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  count: number;
  saving?: boolean;
  emailSending?: boolean;
  variant: "invoice" | "selfbill";
  onMarkPaid: () => void;
  onClear: () => void;
  onEmail?: () => void;
  onCancel?: () => void;
};

export function BillingBulkBar({
  count,
  saving,
  emailSending,
  variant,
  onMarkPaid,
  onClear,
  onEmail,
  onCancel,
}: Props) {
  if (count <= 0) return null;
  const busy = saving || emailSending;
  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-border-light bg-[#020040] px-5 py-3 shadow-xl">
      <span className="text-sm font-semibold tabular-nums text-white/80">{count} selected</span>
      <div className="h-4 w-px bg-white/20" />
      <button
        type="button"
        disabled={busy}
        onClick={onMarkPaid}
        className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-emerald-600 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
        Mark as paid
      </button>
      {variant === "selfbill" && onEmail ? (
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
