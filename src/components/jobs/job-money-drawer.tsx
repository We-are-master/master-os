"use client";

import { useEffect, useRef, useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Invoice, JobPaymentMethod } from "@/types/database";
import { formatCurrency } from "@/lib/utils";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const LS_CLIENT = "mos-job-money-method-client";
const LS_PARTNER = "mos-job-money-method-partner";

const EPS = 0.02;

export type JobMoneyDrawerFlow = "client_pay" | "client_extra" | "partner_pay" | "partner_extra";

export type ClientPayApplyAs = "deposit" | "final";

export type JobMoneySubmitPayload = {
  flow: JobMoneyDrawerFlow;
  amount: number;
  paymentDate: string;
  method: JobPaymentMethod;
  note: string;
  clientPayApplyAs?: ClientPayApplyAs;
  /** Optional; prefixed into payment note for history only. */
  paymentLedgerLabel?: string;
};

/** Deposit scheduled vs still owed (for payment type UI). */
export type JobMoneyDrawerClientCashContext = {
  depositScheduled: number;
  depositRemaining: number;
};

type Props = {
  open: boolean;
  flow: JobMoneyDrawerFlow | null;
  onClose: () => void;
  onSubmit: (payload: JobMoneySubmitPayload) => Promise<void>;
  submitting: boolean;
  stripeInvoices: Invoice[];
  clientCashContext?: JobMoneyDrawerClientCashContext;
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

const CLIENT_LEDGER_LABEL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Optional — for history" },
  { value: "Deposit", label: "Deposit" },
  { value: "Partial payment", label: "Partial payment" },
  { value: "Advance payment", label: "Advance payment" },
  { value: "Other", label: "Other" },
];

const PARTNER_LEDGER_LABEL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Optional — for history" },
  { value: "Advance", label: "Advance" },
  { value: "Partial payout", label: "Partial payout" },
  { value: "Early payment", label: "Early payment" },
  { value: "Other", label: "Other" },
];

/** Match Cash In — Finance Summary “CASH IN — CLIENT” extra rows. */
const CLIENT_EXTRA_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "Extra charges", label: "Extra charges" },
  { value: "CCZ", label: "CCZ" },
  { value: "Parking", label: "Parking" },
  { value: "Materials", label: "Materials" },
  { value: "Other", label: "Other" },
];

/** Match Cash Out partner extras — same labels as Finance Summary “CASH OUT — PARTNER”. */
const PARTNER_EXTRA_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "Extra payout", label: "Extra payout" },
  { value: "CCZ", label: "CCZ" },
  { value: "Parking", label: "Parking" },
  { value: "Materials", label: "Materials" },
  { value: "Other", label: "Other" },
];

function isClientFlow(flow: JobMoneyDrawerFlow): boolean {
  return flow === "client_pay" || flow === "client_extra";
}

function flowTitle(flow: JobMoneyDrawerFlow): string {
  switch (flow) {
    case "client_pay":
    case "partner_pay":
      return "Record Payment";
    case "client_extra":
      return "Add extra charge";
    case "partner_extra":
      return "Add extra payout";
  }
}

function flowSubmitLabel(flow: JobMoneyDrawerFlow): string {
  if (flow === "client_pay" || flow === "partner_pay") return "Record Payment";
  return flowTitle(flow);
}

function readSavedMethod(flow: JobMoneyDrawerFlow): JobPaymentMethod {
  if (typeof window === "undefined") return "bank_transfer";
  const raw = window.localStorage.getItem(isClientFlow(flow) ? LS_CLIENT : LS_PARTNER);
  if (isClientFlow(flow)) {
    if (raw === "stripe" || raw === "bank_transfer" || raw === "cash") return raw;
  } else {
    if (raw === "bank_transfer" || raw === "cash" || raw === "other") return raw;
  }
  return "bank_transfer";
}

function persistMethod(flow: JobMoneyDrawerFlow, m: JobPaymentMethod) {
  try {
    window.localStorage.setItem(isClientFlow(flow) ? LS_CLIENT : LS_PARTNER, m);
  } catch {
    /* ignore */
  }
}

function isPayFlow(flow: JobMoneyDrawerFlow): boolean {
  return flow === "client_pay" || flow === "partner_pay";
}

export function JobMoneyDrawer({
  open,
  flow,
  onClose,
  onSubmit,
  submitting,
  stripeInvoices,
  clientCashContext,
}: Props) {
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<JobPaymentMethod>("bank_transfer");
  const [note, setNote] = useState("");
  const [clientPayApplyAs, setClientPayApplyAs] = useState<ClientPayApplyAs>("final");
  const [paymentLedgerLabel, setPaymentLedgerLabel] = useState("");
  const [extraType, setExtraType] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

  const depositRemaining = clientCashContext?.depositRemaining ?? 0;
  const depositScheduled = clientCashContext?.depositScheduled ?? 0;
  const canRecordDeposit = depositRemaining > EPS;

  /* eslint-disable react-hooks/set-state-in-effect -- reset form when drawer opens (same pattern as quotes modal) */
  useEffect(() => {
    if (!open || !flow) return;
    setAmount("");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setNote("");
    setPaymentLedgerLabel("");
    setExtraType(flow === "partner_extra" ? "Extra payout" : "Extra charges");
    if (isPayFlow(flow)) {
      setMethod(readSavedMethod(flow));
    } else {
      setMethod(isClientFlow(flow) ? "bank_transfer" : "other");
    }
    if (flow === "client_pay") {
      setClientPayApplyAs(canRecordDeposit ? "deposit" : "final");
    }
    const id = requestAnimationFrame(() => {
      amountRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open, flow, canRecordDeposit]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!open || !flow || !isPayFlow(flow) || method === "stripe") return;
    const id = requestAnimationFrame(() => amountRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [method, open, flow]);

  if (!flow) return null;

  const isClientStripe = flow === "client_pay" && method === "stripe";
  const n = Number(amount);
  const amountOk = amount.trim() !== "" && !Number.isNaN(n) && n > 0;
  const isOtherExtra = !isPayFlow(flow) && extraType.trim().toLowerCase() === "other";
  const noteOk = !isOtherExtra || note.trim().length > 0;
  const canSubmit = !isClientStripe && amountOk && noteOk;

  const handleMethodChange = (m: JobPaymentMethod) => {
    setMethod(m);
    if (isPayFlow(flow)) persistMethod(flow, m);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const pay = isPayFlow(flow);
    const submitMethod = pay ? method : isClientFlow(flow) ? "bank_transfer" : "other";
    const applyForSubmit: ClientPayApplyAs | undefined =
      flow === "client_pay"
        ? clientPayApplyAs === "deposit" && !canRecordDeposit
          ? "final"
          : clientPayApplyAs
        : undefined;
    const noteWithExtraType =
      !isPayFlow(flow) && extraType.trim()
        ? `${extraType.trim()}${note.trim() ? ` — ${note.trim()}` : ""}`
        : note;
    await onSubmit({
      flow,
      amount: n,
      paymentDate: pay ? paymentDate : new Date().toISOString().slice(0, 10),
      method: submitMethod,
      note: noteWithExtraType,
      ...(applyForSubmit != null ? { clientPayApplyAs: applyForSubmit } : {}),
      ...(pay && paymentLedgerLabel.trim()
        ? { paymentLedgerLabel: paymentLedgerLabel.trim() }
        : {}),
    });
  };

  const stripeLinks = stripeInvoices.filter((i) => i.stripe_payment_link_url);

  const helpExtra = (
    <p className="text-[11px] text-text-tertiary leading-relaxed">
      {flow === "client_extra"
        ? "Increases the job total and linked invoice. This is not a payment — use Record Payment when money is received."
        : "Positive partner cost: increases Total to pay, self-bill gross for this job, and amount due. Not a cash-out row — use Record Payment when you send money to the partner."}
    </p>
  );

  const clientPayTypeOptions = [
    {
      value: "deposit" as const,
      label:
        depositScheduled > EPS
          ? `Deposit (up to ${formatCurrency(depositRemaining)} due)`
          : "Deposit (none scheduled)",
      disabled: !canRecordDeposit,
    },
    { value: "final" as const, label: "Partial payment (final balance)", disabled: false },
  ];

  return (
    <Drawer
      open={open && !!flow}
      onClose={onClose}
      title={flowTitle(flow)}
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
              {flowSubmitLabel(flow)}
            </Button>
          </div>
        )
      }
    >
      <form id="job-money-drawer-form" onSubmit={handleFormSubmit} className="px-5 py-5 space-y-5">
        {flow === "client_pay" && !isClientStripe ? (
          <div className="space-y-4">
            <div>
              <Select
                label="Payment type"
                value={clientPayApplyAs}
                onChange={(e) => setClientPayApplyAs(e.target.value as ClientPayApplyAs)}
                options={clientPayTypeOptions.map((o) => ({ value: o.value, label: o.label, disabled: o.disabled }))}
                className="h-10"
              />
              <p className="text-[11px] text-text-tertiary mt-1.5 leading-snug">
                Choose whether this receipt applies to the scheduled deposit or to the final balance. Deposit is disabled when
                nothing is due.
              </p>
            </div>
            <div>
              <Select
                label="Classification (optional)"
                value={paymentLedgerLabel}
                onChange={(e) => setPaymentLedgerLabel(e.target.value)}
                options={CLIENT_LEDGER_LABEL_OPTIONS}
                className="h-10"
              />
              <p className="text-[11px] text-text-tertiary mt-1.5 leading-snug">
                Deposit / Partial payment / Advance / Other — history label only. Use Payment type above for deposit vs final balance.
              </p>
            </div>
          </div>
        ) : null}

        {isPayFlow(flow) ? (
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Method</label>
            <Select
              value={method}
              onChange={(e) => handleMethodChange(e.target.value as JobPaymentMethod)}
              options={isClientFlow(flow) ? CLIENT_METHODS : PARTNER_METHODS}
              className="h-10"
            />
            {flow === "partner_pay" ? (
              <p className="text-[11px] text-text-tertiary mt-1.5">How you sent money to the partner (ledger record only).</p>
            ) : null}
          </div>
        ) : null}

        {flow === "partner_pay" ? (
          <div>
            <Select
              label="Classification (optional)"
              value={paymentLedgerLabel}
              onChange={(e) => setPaymentLedgerLabel(e.target.value)}
              options={PARTNER_LEDGER_LABEL_OPTIONS}
              className="h-10"
            />
            <p className="text-[11px] text-text-tertiary mt-1.5 leading-snug">
              Advance / Partial payout / Early payment / Other — history label only. Does not change Total to pay or self-bill gross.
            </p>
          </div>
        ) : null}

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
            {!isPayFlow(flow) ? helpExtra : null}
            {!isPayFlow(flow) ? (
              <div>
                <Select
                  label="Extra type"
                  value={extraType}
                  onChange={(e) => setExtraType(e.target.value)}
                  options={flow === "partner_extra" ? PARTNER_EXTRA_TYPE_OPTIONS : CLIENT_EXTRA_TYPE_OPTIONS}
                  className="h-10"
                />
              </div>
            ) : null}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Amount</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-text-tertiary">£</span>
                <Input
                  ref={amountRef}
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-11 pl-7 text-base font-medium tabular-nums"
                  placeholder="0.00"
                />
              </div>
            </div>
            {isPayFlow(flow) ? (
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Date</label>
                <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
              </div>
            ) : null}
            {isOtherExtra ? (
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  Note <span className="text-red-500">*</span>
                </label>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Describe this extra"
                  className="h-10"
                  required
                />
              </div>
            ) : null}
          </>
        )}
      </form>
    </Drawer>
  );
}
