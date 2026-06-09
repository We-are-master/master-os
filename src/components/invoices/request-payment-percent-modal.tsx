"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { clampDepositPercent, depositAmountFromPercent } from "@/lib/quote-deposit";
import { invoiceRequestBaseAmount } from "@/lib/invoice-request-amount";
import { cn, formatCurrency } from "@/lib/utils";
import type { Invoice } from "@/types/database";

type RequestPaymentPercentModalProps = {
  open: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  recipientEmail?: string | null;
  billingModeLabel?: string;
  loading?: boolean;
  onConfirm: (requestPercent: number) => void | Promise<void>;
};

export function RequestPaymentPercentModal({
  open,
  onClose,
  invoice,
  recipientEmail,
  billingModeLabel,
  loading = false,
  onConfirm,
}: RequestPaymentPercentModalProps) {
  const [percent, setPercent] = useState(50);

  useEffect(() => {
    if (open) setPercent(50);
  }, [open, invoice?.id]);

  const baseAmount = useMemo(
    () => (invoice ? invoiceRequestBaseAmount(invoice) : 0),
    [invoice],
  );
  const percentClamped = clampDepositPercent(percent);
  const amountDueNow = depositAmountFromPercent(baseAmount, percentClamped);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request payment"
      subtitle={invoice ? `${invoice.reference} — invoice total ${formatCurrency(baseAmount)}` : ""}
      size="md"
    >
      {invoice ? (
        <div className="space-y-4 px-4 py-4 sm:space-y-5 sm:px-6 sm:py-5">
          {recipientEmail ? (
            <p className="min-w-0 text-sm leading-relaxed text-text-secondary">
              Sends to{" "}
              <span className="break-all font-medium text-text-primary sm:break-words">
                {recipientEmail}
              </span>
              {billingModeLabel ? (
                <span className="text-text-tertiary"> ({billingModeLabel})</span>
              ) : null}
            </p>
          ) : null}

          <div className="space-y-3 rounded-xl border border-border-light bg-card/80 p-3.5 sm:p-4">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <p className="min-w-0 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary sm:text-[11px]">
                % of total to request
              </p>
              <span className="shrink-0 text-base font-bold tabular-nums text-primary sm:text-lg">
                {percentClamped}%
              </span>
            </div>
            <div className="px-0.5 py-1">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={percentClamped}
                onChange={(e) => setPercent(Number(e.target.value))}
                aria-label="Percentage of invoice total to request"
                className="h-2.5 w-full min-w-0 cursor-pointer appearance-none rounded-full bg-border accent-primary touch-manipulation dark:bg-zinc-700 sm:h-2"
              />
            </div>
            <p className="text-xs leading-relaxed text-text-secondary sm:text-sm">
              <span className="block sm:inline">
                Requesting{" "}
                <span className="font-semibold tabular-nums text-text-primary">
                  {formatCurrency(amountDueNow)}
                </span>
              </span>
              {percentClamped < 100 ? (
                <span className="mt-0.5 block text-text-tertiary sm:mt-0 sm:inline">
                  <span className="hidden sm:inline"> </span>
                  ({percentClamped}% of {formatCurrency(baseAmount)})
                </span>
              ) : null}
            </p>
          </div>

          <div className="flex flex-col-reverse gap-2 pt-0.5 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={loading}
              disabled={amountDueNow <= 0 || !recipientEmail?.trim()}
              onClick={() => void onConfirm(percentClamped)}
              className="w-full sm:w-auto"
            >
              Send request
            </Button>
          </div>
        </div>
      ) : (
        <p className={cn("px-4 py-4 text-sm text-text-tertiary sm:px-6 sm:py-5")}>No invoice selected.</p>
      )}
    </Modal>
  );
}
