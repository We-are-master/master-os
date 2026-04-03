"use client";

import { useEffect, useRef, useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Invoice, JobPaymentMethod } from "@/types/database";
import { cn, formatCurrency } from "@/lib/utils";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const LS_CLIENT = "mos-job-money-method-client";
const LS_PARTNER = "mos-job-money-method-partner";

export type JobMoneyDrawerFlow = "client" | "partner";

export type JobMoneySubmitPayload = {
  amount: number;
  paymentDate: string;
  method: JobPaymentMethod;
  note: string;
  extra: boolean;
};

type Props = {
  open: boolean;
  flow: JobMoneyDrawerFlow | null;
  onClose: () => void;
  onSubmit: (payload: JobMoneySubmitPayload) => Promise<void>;
  submitting: boolean;
  stripeInvoices: Invoice[];
};

const CLIENT_METHODS: { value: JobPaymentMethod; label: string }[] = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "stripe", label: "Stripe" },
];

const PARTNER_METHODS: { value: JobPaymentMethod; label: string }[] = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];

function readSavedMethod(flow: JobMoneyDrawerFlow): JobPaymentMethod {
  if (typeof window === "undefined") return "bank_transfer";
  const raw = window.localStorage.getItem(flow === "client" ? LS_CLIENT : LS_PARTNER);
  if (flow === "client") {
    if (raw === "stripe" || raw === "bank_transfer" || raw === "cash") return raw;
  } else {
    if (raw === "bank_transfer" || raw === "cash" || raw === "other") return raw;
  }
  return "bank_transfer";
}

function persistMethod(flow: JobMoneyDrawerFlow, m: JobPaymentMethod) {
  try {
    window.localStorage.setItem(flow === "client" ? LS_CLIENT : LS_PARTNER, m);
  } catch {
    /* ignore */
  }
}

export function JobMoneyDrawer({ open, flow, onClose, onSubmit, submitting, stripeInvoices }: Props) {
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<JobPaymentMethod>("bank_transfer");
  const [note, setNote] = useState("");
  const [extra, setExtra] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !flow) return;
    setAmount("");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setNote("");
    setExtra(false);
    setMethod(readSavedMethod(flow));
    const id = requestAnimationFrame(() => {
      amountRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open, flow]);

  useEffect(() => {
    if (!open || !flow || method === "stripe") return;
    const id = requestAnimationFrame(() => amountRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [method, open, flow]);

  if (!flow) return null;

  const isClientStripe = flow === "client" && method === "stripe";
  const n = Number(amount);
  const amountOk = amount.trim() !== "" && !Number.isNaN(n) && n > 0;
  const canSubmit = !isClientStripe && amountOk;

  const handleMethodChange = (m: JobPaymentMethod) => {
    setMethod(m);
    persistMethod(flow, m);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !flow) return;
    await onSubmit({
      amount: n,
      paymentDate,
      method,
      note,
      extra,
    });
  };

  const stripeLinks = stripeInvoices.filter((i) => i.stripe_payment_link_url);

  return (
    <Drawer
      open={open && !!flow}
      onClose={onClose}
      title="Add payment"
      width="w-[min(100vw,400px)]"
      className="bg-surface"
      footer={
        isClientStripe ? (
          <div className="px-5 py-4">
            <Button type="button" className="w-full h-10" variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <div className="px-5 py-4 border-t border-border-light bg-surface">
            <Button
              type="submit"
              form="job-money-drawer-form"
              className="w-full h-10"
              loading={submitting}
              disabled={!canSubmit}
            >
              Add payment
            </Button>
          </div>
        )
      }
    >
      <form id="job-money-drawer-form" onSubmit={handleFormSubmit} className="px-5 py-5 space-y-5">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Method</label>
          <Select
            value={method}
            onChange={(e) => handleMethodChange(e.target.value as JobPaymentMethod)}
            options={flow === "client" ? CLIENT_METHODS : PARTNER_METHODS}
            className="h-10"
          />
        </div>

        {isClientStripe ? (
          <div className="space-y-3 rounded-xl border border-border-light bg-card/60 px-3 py-3">
            <p className="text-sm text-text-secondary leading-snug">Payments sync when the client pays the link.</p>
            {stripeLinks.length > 0 ? (
              <ul className="space-y-2">
                {stripeLinks.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border-light bg-surface px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-text-primary truncate">{inv.reference}</p>
                      <p className="text-[11px] text-text-tertiary tabular-nums">{formatCurrency(inv.amount)}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        icon={<Copy className="h-3 w-3" />}
                        onClick={() => {
                          void navigator.clipboard.writeText(inv.stripe_payment_link_url!);
                          toast.success("Copied");
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        icon={<ExternalLink className="h-3 w-3" />}
                        onClick={() => window.open(inv.stripe_payment_link_url!, "_blank", "noopener,noreferrer")}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-amber-600 dark:text-amber-400">No Stripe link on this job yet.</p>
            )}
            <p className="text-[11px] text-text-tertiary">Switch method to Bank or Cash to record a payment manually.</p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-xs font-medium text-text-secondary">Type</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setExtra(false)}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors text-center",
                    !extra
                      ? "border-primary bg-primary/10 text-text-primary"
                      : "border-border-light bg-card/40 text-text-secondary hover:bg-surface-hover",
                  )}
                >
                  Payment received
                </button>
                <button
                  type="button"
                  onClick={() => setExtra(true)}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors text-center",
                    extra
                      ? "border-primary bg-primary/10 text-text-primary"
                      : "border-border-light bg-card/40 text-text-secondary hover:bg-surface-hover",
                  )}
                >
                  Additional payment
                </button>
              </div>
              {extra ? (
                <p className="text-[11px] text-text-tertiary leading-relaxed pt-0.5">
                  {flow === "client"
                    ? "Extra charge — increases the job total and invoice."
                    : "Extra payout — beyond planned partner cost."}
                </p>
              ) : null}
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Amount</label>
              <Input
                ref={amountRef}
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-11 text-base font-medium tabular-nums"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Date</label>
              <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Note</label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" className="h-10" />
            </div>
          </>
        )}
      </form>
    </Drawer>
  );
}
