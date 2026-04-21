"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { Check, Banknote, Wallet, Building2, HardHat, Receipt, Shield } from "lucide-react";
import type { PayoutItem, PayoutCategory } from "./payout-data";

const CATEGORY_BADGE: Record<PayoutCategory, { label: string; Icon: typeof HardHat }> = {
  workforce: { label: "Workforce", Icon: HardHat },
  partners: { label: "Partner", Icon: Building2 },
  expenses: { label: "Expense", Icon: Receipt },
};

type PaymentMethod = "bank_transfer" | "manual";

interface ReviewPayModalProps {
  open: boolean;
  onClose: () => void;
  items: PayoutItem[];
  weekLabel: string;
  /** Formatted "Payout Mon 21 Apr" hint rendered in the subtitle. */
  payoutHint: string;
  /** Called with the chosen payment method once all safety checks pass. Wire to a real flow later. */
  onConfirm: (method: PaymentMethod) => Promise<void> | void;
}

/**
 * "Review & pay" is the final safety net before releasing funds.
 * It enforces three checks and summarises everything in one place so treasury
 * can sanity-check bank details, amounts, and company balance at a glance.
 */
export function ReviewPayModal({
  open,
  onClose,
  items,
  weekLabel,
  payoutHint,
  onConfirm,
}: ReviewPayModalProps) {
  const [bankVerified, setBankVerified] = useState(false);
  const [amountsVerified, setAmountsVerified] = useState(false);
  const [balanceVerified, setBalanceVerified] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) {
      setBankVerified(false);
      setAmountsVerified(false);
      setBalanceVerified(false);
      setMethod("bank_transfer");
      setConfirming(false);
    }
  }, [open]);

  const totals = useMemo(() => {
    let total = 0;
    const byCategory: Record<PayoutCategory, number> = { workforce: 0, partners: 0, expenses: 0 };
    for (const it of items) {
      total += it.amount;
      byCategory[it.category] += it.amount;
    }
    return { total, byCategory };
  }, [items]);

  const allChecksGreen = bankVerified && amountsVerified && balanceVerified;

  const handleConfirm = async () => {
    if (!allChecksGreen || confirming) return;
    setConfirming(true);
    try {
      await onConfirm(method);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={confirming ? () => undefined : onClose}
      title="Review & pay"
      subtitle={`${weekLabel} · ${payoutHint}`}
      size="lg"
    >
      <div className="flex max-h-[75vh] flex-col">
        {/* Orange total banner */}
        <div className="border-b border-[#F5CFB8] bg-[#FFF8F3] px-5 py-4 sm:px-6">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#B25418]">Total to release</p>
          <p className="mt-0.5 text-[28px] font-bold tabular-nums leading-none text-[#ED4B00]">
            {formatCurrency(totals.total)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#733712]">
            <span>
              <strong className="tabular-nums">{items.length}</strong> item{items.length === 1 ? "" : "s"}
            </span>
            {(["workforce", "partners", "expenses"] as PayoutCategory[])
              .filter((k) => totals.byCategory[k] > 0.001)
              .map((k) => (
                <span key={k}>
                  {CATEGORY_BADGE[k].label}: <strong className="tabular-nums">{formatCurrency(totals.byCategory[k])}</strong>
                </span>
              ))}
          </div>
        </div>

        {/* Recipients list */}
        <div className="max-h-[260px] overflow-y-auto px-5 py-3 sm:px-6">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
            Recipients · {items.length}
          </p>
          <div className="divide-y divide-border-light rounded-lg border border-border-light">
            {items.map((it) => {
              const meta = CATEGORY_BADGE[it.category];
              const Icon = meta.Icon;
              return (
                <div key={it.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Avatar name={it.avatarName} size="xs" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-text-primary">{it.name}</p>
                    <p className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
                      <Icon className="h-2.5 w-2.5" aria-hidden />
                      <span>{meta.label}</span>
                      <span>·</span>
                      <span className="truncate">{it.bankLast4 ?? "No bank details"}</span>
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-text-primary">
                    {formatCurrency(it.amount)}
                  </p>
                </div>
              );
            })}
            {items.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-text-tertiary">Nothing selected.</p>
            ) : null}
          </div>
        </div>

        {/* Safety checklist — MUST be ticked before Confirm enables */}
        <div className="border-t border-border-light bg-[#FAFAFB] px-5 py-4 sm:px-6">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#020040]">
            <Shield className="h-3 w-3" aria-hidden />
            Safety checks — all three required
          </p>
          <div className="space-y-1.5">
            <SafetyCheck
              checked={bankVerified}
              onChange={setBankVerified}
              label="Bank details verified for all recipients"
            />
            <SafetyCheck
              checked={amountsVerified}
              onChange={setAmountsVerified}
              label="Amounts match approved self-bills / invoices"
            />
            <SafetyCheck
              checked={balanceVerified}
              onChange={setBalanceVerified}
              label={`Company bank has enough balance for ${formatCurrency(totals.total)}`}
            />
          </div>
        </div>

        {/* Payment method selector */}
        <div className="border-t border-border-light px-5 py-3 sm:px-6">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
            Payment method
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <MethodCard
              active={method === "bank_transfer"}
              onClick={() => setMethod("bank_transfer")}
              Icon={Banknote}
              title="Bank transfer (lot)"
              hint="Export file → upload to bank, then mark paid"
            />
            <MethodCard
              active={method === "manual"}
              onClick={() => setMethod("manual")}
              Icon={Wallet}
              title="Mark paid manually"
              hint="Already paid — just record here"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border-light bg-card px-5 py-3 sm:px-6">
          <Button variant="outline" size="sm" onClick={onClose} disabled={confirming}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void handleConfirm()}
            disabled={!allChecksGreen || confirming || items.length === 0}
            loading={confirming}
            className="bg-[#ED4B00] hover:bg-[#D84300] text-white border-[#ED4B00] hover:border-[#D84300]"
          >
            Confirm &amp; pay {formatCurrency(totals.total)}
          </Button>
        </div>
      </div>
      <span className="sr-only">{formatDate(new Date().toISOString().slice(0, 10))}</span>
    </Modal>
  );
}

function SafetyCheck({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors",
        checked
          ? "border-[#0F6E56]/30 bg-[#EFF7F3]"
          : "border-border-light bg-card hover:bg-surface-hover",
      )}
    >
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
          checked ? "border-[#0F6E56] bg-[#0F6E56] text-white" : "border-border bg-card",
        )}
      >
        {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        className={cn("text-xs font-medium", checked ? "text-[#0F6E56]" : "text-text-primary")}
      >
        {label}
      </span>
    </label>
  );
}

function MethodCard({
  active,
  onClick,
  Icon,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  Icon: typeof Banknote;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
        active
          ? "border-[#ED4B00] bg-[#FFF8F3]"
          : "border-border-light bg-card hover:border-border",
      )}
    >
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
          active ? "bg-[#ED4B00]/15 text-[#ED4B00]" : "bg-surface-hover text-text-tertiary",
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className={cn("text-xs font-semibold", active ? "text-[#B25418]" : "text-text-primary")}>
          {title}
        </p>
        <p className="mt-0.5 text-[10px] leading-tight text-text-tertiary">{hint}</p>
      </div>
    </button>
  );
}
