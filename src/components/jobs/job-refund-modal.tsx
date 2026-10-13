"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatCurrencyPrecise } from "@/lib/utils";

type Method = "stripe" | "bank_transfer";
type Info = { paid: number; cardRefundable: number; cardNote: string | null; invoiceRef: string | null };

/**
 * Refund ao cliente a partir do card do job (dono, 13/10/2026).
 * Cartão: a Stripe devolve e o OS registra. Transferência: o OS só registra,
 * o dinheiro sai do banco por quem pediu.
 */
export function JobRefundModal({ open, jobId, jobReference, clientName, onClose, onDone }: {
  open: boolean;
  jobId: string;
  jobReference: string;
  clientName?: string | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [info, setInfo] = useState<Info | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<Method>("bank_transfer");
  const [submitting, setSubmitting] = useState(false);
  // Um id por abertura do modal: clique dobrado não vira dois refunds.
  const requestId = useMemo(() => (open ? crypto.randomUUID() : ""), [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setInfo(null);
    setLoadError(null);
    setAmount("");
    setReason("");
    void (async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}/refund`);
        const data = (await res.json().catch(() => ({}))) as Partial<Info> & { error?: string };
        if (!alive) return;
        if (!res.ok) {
          setLoadError(data.error || "Could not load what this customer paid.");
          return;
        }
        const next: Info = { paid: Number(data.paid ?? 0), cardRefundable: Number(data.cardRefundable ?? 0), cardNote: data.cardNote ?? null, invoiceRef: data.invoiceRef ?? null };
        setInfo(next);
        setMethod(next.cardRefundable > 0.02 ? "stripe" : "bank_transfer");
        setAmount(next.paid > 0 ? next.paid.toFixed(2) : "");
      } catch {
        if (alive) setLoadError("Could not load what this customer paid.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, jobId]);

  const value = Math.round(Number(amount) * 100) / 100;
  const limit = info ? (method === "stripe" ? info.cardRefundable : info.paid) : 0;
  const problem = !info
    ? null
    : !(value > 0)
      ? "Enter the amount to refund."
      : value > limit + 0.005
        ? method === "stripe"
          ? `Only ${formatCurrencyPrecise(info.cardRefundable)} can go back to the card.`
          : `The customer has paid ${formatCurrencyPrecise(info.paid)} on this job.`
        : !reason.trim()
          ? "Say why this refund is being made."
          : null;

  async function submit() {
    if (!info || problem) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: value, reason: reason.trim(), method, request_id: requestId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error || "Refund failed.");
        return;
      }
      toast.success(
        method === "stripe"
          ? `${formatCurrencyPrecise(value)} refunded to the card. It reaches the customer in 5 to 10 days.`
          : `${formatCurrencyPrecise(value)} refund recorded. Now send the transfer from the bank.`,
      );
      await onDone();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const option = (m: Method, title: string, hint: string, disabled: boolean) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setMethod(m)}
      className={cn(
        "flex-1 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        method === m ? "border-primary bg-primary/5" : "border-border-light hover:bg-surface-hover",
      )}
    >
      <span className="block text-xs font-semibold text-text-primary">{title}</span>
      <span className="block text-[11px] leading-snug text-text-tertiary">{hint}</span>
    </button>
  );

  return (
    <Modal open={open} onClose={onClose} title="Refund customer" subtitle={[jobReference, clientName?.trim()].filter(Boolean).join(" · ")}>
      <div className="space-y-4 p-4">
        {loadError ? (
          <p className="text-sm text-red-600">{loadError}</p>
        ) : !info ? (
          <p className="text-sm text-text-tertiary">Loading what this customer paid…</p>
        ) : info.paid <= 0.02 ? (
          <p className="text-sm text-text-secondary">This customer has not paid anything on this job yet, so there is nothing to refund.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-border-light bg-surface-hover/40 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Paid by the customer</p>
                <p className="text-lg font-bold tabular-nums text-text-primary">{formatCurrencyPrecise(info.paid)}</p>
              </div>
              <div className="rounded-xl border border-border-light bg-surface-hover/40 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Can go back to the card</p>
                <p className="text-lg font-bold tabular-nums text-text-primary">{formatCurrencyPrecise(info.cardRefundable)}</p>
              </div>
            </div>
            <div className="flex gap-2">
              {option("stripe", "Back to the card", info.cardRefundable > 0.02 ? "Stripe refunds it now." : info.cardNote || "Nothing on this job was paid by card.", info.cardRefundable <= 0.02)}
              {option("bank_transfer", "Bank transfer", "Records it here. You send the transfer from the bank.", false)}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-secondary" htmlFor="refund-amount">Amount (£)</label>
              <div className="flex items-center gap-2">
                <Input id="refund-amount" type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="max-w-[9rem]" />
                <Button type="button" size="sm" variant="ghost" onClick={() => setAmount(limit.toFixed(2))}>Full</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setAmount((Math.round(limit * 50) / 100).toFixed(2))}>50%</Button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-secondary" htmlFor="refund-reason">Reason</label>
              <Input id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Job cancelled, goodwill, overpayment…" maxLength={300} />
            </div>
            <p className="text-[11px] leading-snug text-text-tertiary">
              The refund goes into the payment history of this job and the invoice{info.invoiceRef ? ` ${info.invoiceRef.replace(/^RCP-/, "INV-")}` : ""} goes back to showing the balance. The customer is not emailed.
            </p>
            {problem ? <p className="text-[11px] text-amber-800 dark:text-amber-300">{problem}</p> : null}
          </>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="danger" size="sm" loading={submitting} disabled={!info || info.paid <= 0.02 || !!problem || submitting} onClick={() => void submit()}>
            {method === "stripe" ? "Refund to card" : "Record refund"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
