"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { Pencil, PoundSterling } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { PricingSourceChip } from "@/components/shared/pricing-source-chip";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import type { ResolvedJobPricing } from "@/lib/job-pricing-resolver";
import type { ResolvedCatalogLinePricing } from "@/lib/catalog-line-pricing";
import { FixfyModalSection } from "@/components/ui/fixfy-modal";

export const JOB_CREATE_MODAL_SECTION_IDS = [
  "work",
  "client",
  "access",
  "scope",
  "partner",
] as const;

export type JobCreateModalSectionId = (typeof JOB_CREATE_MODAL_SECTION_IDS)[number];

export const JOB_CREATE_MODAL_STEPS: { id: JobCreateModalSectionId; label: string }[] = [
  { id: "work", label: "Rate" },
  { id: "client", label: "Schedule" },
  { id: "access", label: "Charges" },
  { id: "scope", label: "Scope" },
  { id: "partner", label: "Partner" },
];

const HOURLY_BILLING_HINT =
  "Rates prefilled from the call-out — edit to override. Billing: up to 1h = 1h minimum, then 30-min increments from timer logs.";
const MIN_HOURS_HINT = "Minimum billed hours (catalog default or 2h). Totals update as you edit rates or hours.";
const FIXED_PRICING_HINT = "Client price from catalogue or account override. Partner cost is manual unless auto-filled from margin hint.";

export function JobCreateModalSection({
  id,
  title,
  badge,
  children,
  className,
}: {
  id: JobCreateModalSectionId;
  title: string;
  badge?: "required" | "optional";
  children: ReactNode;
  className?: string;
}) {
  return (
    <FixfyModalSection id={id} title={title} badge={badge} className={className}>
      {children}
    </FixfyModalSection>
  );
}

function PoundFieldLabel({
  text,
  hint,
  trailing,
  className,
}: {
  text: string;
  hint?: string;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex flex-wrap items-center gap-1 text-xs font-medium text-text-secondary mb-1.5",
        className,
      )}
    >
      <PoundSterling className="h-3 w-3 shrink-0 text-text-tertiary" strokeWidth={2.25} aria-hidden />
      <span>{text}</span>
      {hint ? <FixfyHintIcon text={hint} /> : null}
      {trailing}
    </label>
  );
}

function FieldLabel({
  text,
  hint,
  trailing,
  className,
}: {
  text: string;
  hint?: string;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex flex-wrap items-center gap-1 text-xs font-medium text-text-secondary mb-1.5",
        className,
      )}
    >
      <span>{text}</span>
      {hint ? <FixfyHintIcon text={hint} /> : null}
      {trailing}
    </label>
  );
}

type PricingFormSlice = {
  job_type: string;
  client_price: string;
  partner_cost: string;
  billed_hours: string;
  hourly_client_rate: string;
  hourly_partner_rate: string;
  catalog_service_id: string;
  materials_cost?: string;
  /** Smart pricing: flat add-on (materials, bags, etc.) on top of labour — stored in job.extras_amount. */
  extra_payment?: string;
  extra_payment_received?: boolean;
};

const EXTRA_PAYMENT_HINT =
  "One-off add-on on top of the smart price — e.g. mulch bag, materials, or extras the client pays for in addition to labour. Included in the job total and invoice.";
const EXTRA_PAYMENT_RECEIVED_HINT =
  "Tick when the client has already paid this extra (e.g. paid upfront for materials). We record it as a deposit received on the new job.";

type JobCreateModalPricingFieldsProps = {
  form: PricingFormSlice;
  update: (field: string, value: string) => void;
  pricing: ResolvedJobPricing | null;
  pricingResolving: boolean;
  isStackablePricing: boolean;
  stackableLinePricing: ResolvedCatalogLinePricing | null;
  stackablePricingLoading: boolean;
  hourlyPreview: { clientTotal: number; partnerTotal: number };
  accessSurchargePreview: number;
  estimatedMarginPct: number;
  showHeading?: boolean;
};

function pricingModeHint(props: JobCreateModalPricingFieldsProps): string {
  const { pricingResolving, stackablePricingLoading, isStackablePricing, form } = props;
  if (stackablePricingLoading || pricingResolving) return "Loading catalogue pricing…";
  if (isStackablePricing) return "Totals are calculated from the selected package and additionals.";
  if (form.job_type === "hourly") return `Auto from rates × hours. ${HOURLY_BILLING_HINT}`;
  if (form.catalog_service_id) return FIXED_PRICING_HINT;
  return "Enter client and partner amounts manually.";
}

export function JobCreateModalPricingPencil({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Edit pricing"
      title="Edit pricing"
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border-light bg-card text-text-tertiary transition-colors hover:border-primary/30 hover:bg-surface-hover hover:text-text-primary",
        className,
      )}
    >
      <Pencil className="h-3.5 w-3.5" />
    </button>
  );
}

export function JobCreateModalPricingSummary(props: JobCreateModalPricingFieldsProps) {
  const {
    form,
    pricingResolving,
    stackablePricingLoading,
    isStackablePricing,
    stackableLinePricing,
    hourlyPreview,
    accessSurchargePreview,
    estimatedMarginPct,
  } = props;

  if (stackablePricingLoading || pricingResolving) {
    return (
      <p className="text-[11px] text-text-tertiary tabular-nums">Loading pricing…</p>
    );
  }

  if (isStackablePricing && stackableLinePricing) {
    return (
      <p className="text-[11px] text-text-secondary tabular-nums">
        <span className="font-medium text-text-primary">
          {formatCurrency(stackableLinePricing.clientTotal)}
        </span>
        <span className="text-text-tertiary"> client · </span>
        <span className="font-medium text-text-primary">
          {formatCurrency(stackableLinePricing.partnerTotal)}
        </span>
        <span className="text-text-tertiary"> partner · package</span>
      </p>
    );
  }

  if (form.job_type === "hourly") {
    const extra = Math.max(0, Number(form.extra_payment) || 0);
    const clientTotal = hourlyPreview.clientTotal + accessSurchargePreview + extra;
    const hrs = form.billed_hours || "—";
    return (
      <p className="text-[11px] text-text-secondary tabular-nums">
        <span className="font-medium text-text-primary">{formatCurrency(clientTotal)}</span>
        <span className="text-text-tertiary"> client · </span>
        <span className="font-medium text-text-primary">{formatCurrency(hourlyPreview.partnerTotal)}</span>
        <span className="text-text-tertiary"> partner · </span>
        <span className="font-medium text-text-primary">{hrs}h</span>
        <span className="text-text-tertiary"> min</span>
        {extra > 0 ? (
          <>
            <span className="text-text-tertiary"> · +</span>
            <span className="font-medium text-text-primary">{formatCurrency(extra)}</span>
            <span className="text-text-tertiary"> extra</span>
            {form.extra_payment_received ? (
              <span className="text-emerald-600 dark:text-emerald-400 font-medium"> · received</span>
            ) : null}
          </>
        ) : null}
      </p>
    );
  }

  const client = Number(form.client_price) || 0;
  const partner = Number(form.partner_cost) || 0;
  if (client <= 0 && partner <= 0) {
    return <p className="text-[11px] text-text-tertiary">No pricing set — click pencil to edit</p>;
  }

  return (
    <p className="text-[11px] text-text-secondary tabular-nums">
      <span className="font-medium text-text-primary">{formatCurrency(client)}</span>
      <span className="text-text-tertiary"> client · </span>
      <span className="font-medium text-text-primary">{formatCurrency(partner)}</span>
      <span className="text-text-tertiary"> partner</span>
      {client > 0 ? (
        <>
          <span className="text-text-tertiary"> · </span>
          <span
            className={cn(
              "font-semibold",
              estimatedMarginPct >= 20
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-amber-600 dark:text-amber-400",
            )}
          >
            {estimatedMarginPct}% margin
          </span>
        </>
      ) : null}
    </p>
  );
}

/** Smart pricing only — flat extra charge (materials, bags, etc.) below the pricing summary. */
export function JobCreateModalExtraPayment({
  extraPayment,
  extraPaymentReceived,
  onExtraPaymentChange,
  onExtraPaymentReceivedChange,
}: {
  extraPayment: string;
  extraPaymentReceived: boolean;
  onExtraPaymentChange: (value: string) => void;
  onExtraPaymentReceivedChange: (value: boolean) => void;
}) {
  const extraNum = Math.max(0, Number(extraPayment) || 0);

  return (
    <div className="rounded-lg border border-dashed border-border-light bg-surface-hover/20 px-2.5 py-2.5 space-y-2 min-w-0">
      <div className="flex items-center gap-1.5">
        <p className="text-[11px] font-medium text-text-secondary">Extra charge</p>
        <FixfyHintIcon text={EXTRA_PAYMENT_HINT} />
      </div>
      <div className="min-w-0 max-w-[12rem]">
        <PoundFieldLabel text="Amount" />
        <Input
          type="number"
          value={extraPayment}
          onChange={(e) => onExtraPaymentChange(e.target.value)}
          min="0"
          step="0.01"
          placeholder="0"
        />
      </div>
      {extraNum > 0.02 ? (
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={extraPaymentReceived}
            onChange={(e) => onExtraPaymentReceivedChange(e.target.checked)}
            className="mt-0.5 rounded border-border text-primary focus:ring-primary"
          />
          <span className="text-[11px] leading-snug text-text-secondary">
            <span className="font-medium text-text-primary">Already received from client</span>
            <FixfyHintIcon text={EXTRA_PAYMENT_RECEIVED_HINT} className="ml-1" />
          </span>
        </label>
      ) : null}
    </div>
  );
}

export type JobChargeMode = "completion" | "deposit" | "full";

const CHARGE_MODE_HINT =
  "How the client is charged. Full or Deposit sends the payment request by email as soon as the job is created, with a pay button and the bank transfer details. On completion sends nothing now. Clients who pay by card (no account, or an account set to card) always pay before: deposit or full, and the card stays saved for the balance.";

const CHARGE_MODES: { id: JobChargeMode; label: string }[] = [
  { id: "completion", label: "On completion" },
  { id: "deposit", label: "Deposit" },
  { id: "full", label: "Full now" },
];

/** O que o cliente paga agora, a partir do modo e da porcentagem escolhidos no formulário. */
export function chargeNowPercent(mode: JobChargeMode | string | undefined, percent: string | number | undefined): number {
  if (mode === "full") return 100;
  if (mode !== "deposit") return 0;
  const n = Math.round(Number(percent));
  if (!Number.isFinite(n)) return 50;
  return Math.min(99, Math.max(1, n));
}

/** Como o cliente é cobrado neste job: na conclusão, sinal agora (com %) ou total agora. */
export function JobCreateModalChargeMode({
  mode,
  percent,
  total,
  onModeChange,
  onPercentChange,
  paysUpfront = false,
}: {
  mode: JobChargeMode;
  percent: string;
  total: number;
  onModeChange: (value: JobChargeMode) => void;
  onPercentChange: (value: string) => void;
  /** Cliente que paga no cartão (sem conta ou conta card_upfront): sem "On completion" (dono, 14/10/2026). */
  paysUpfront?: boolean;
}) {
  const modes = paysUpfront ? CHARGE_MODES.filter((m) => m.id !== "completion") : CHARGE_MODES;
  const pct = chargeNowPercent(mode, percent);
  const now = Math.round(Math.max(0, total) * pct) / 100;
  const later = Math.round((Math.max(0, total) - now) * 100) / 100;

  const summary =
    pct === 0
      ? "Invoice goes out when the job is done"
      : total > 0.02
        ? `${formatCurrency(now)} now${later > 0.02 ? ` · ${formatCurrency(later)} when done` : ""}`
        : "Set the price to see the amount";

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center gap-1">
        <p className="m-0 text-[12px] font-medium text-text-secondary">Client payment</p>
        <FixfyHintIcon text={CHARGE_MODE_HINT} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg bg-surface-secondary p-0.5" role="radiogroup" aria-label="Client payment">
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              onClick={() => onModeChange(m.id)}
              className={cn(
                "h-8 rounded-md px-3 text-[12px] font-medium transition-colors",
                mode === m.id ? "bg-card text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        {mode === "deposit" ? (
          <label className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-[12px] text-text-secondary">
            <input
              type="number"
              value={percent}
              onChange={(e) => onPercentChange(e.target.value)}
              min="1"
              max="99"
              step="1"
              placeholder="50"
              aria-label="Deposit percent"
              className="w-10 bg-transparent text-right tabular-nums text-text-primary outline-none"
            />
            %
          </label>
        ) : null}
        <span className="ml-auto text-[12px] tabular-nums text-text-tertiary">{summary}</span>
      </div>
    </div>
  );
}

/** Full pricing editor — used inside the pricing modal. */
export function JobCreateModalPricingFields(props: JobCreateModalPricingFieldsProps) {
  const {
    form,
    update,
    pricing,
    pricingResolving,
    isStackablePricing,
    stackableLinePricing,
    stackablePricingLoading,
    hourlyPreview,
    accessSurchargePreview,
    estimatedMarginPct,
    showHeading = true,
  } = props;

  const isHourly = form.job_type === "hourly";
  const modeHint = pricingModeHint(props);

  const marginChip =
    (Number(form.client_price) || 0) + accessSurchargePreview > 0 ? (
      <span
        className={cn(
          "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
          estimatedMarginPct >= 20
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
            : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
        )}
      >
        {estimatedMarginPct}% margin
      </span>
    ) : null;

  return (
    <div className="space-y-3 min-w-0">
      {showHeading ? (
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-text-primary">Pricing</p>
          <FixfyHintIcon text={modeHint} />
        </div>
      ) : null}

      {isStackablePricing && stackableLinePricing ? (
        <div className="rounded-lg border border-border-light bg-card p-2 space-y-1 text-[11px]">
          {stackableLinePricing.lines.map((line) => (
            <div key={line.id} className="flex justify-between gap-2 tabular-nums">
              <span className="text-text-secondary truncate">
                {line.kind === "base" ? "Base" : "+"} {line.label}
              </span>
              <span className="text-text-primary shrink-0">
                {formatCurrency(line.clientAmount)} / {formatCurrency(line.partnerAmount)}
              </span>
            </div>
          ))}
          <div className="flex justify-between gap-2 border-t border-border-light pt-1 font-semibold tabular-nums">
            <span>Total</span>
            <span>
              {formatCurrency(stackableLinePricing.clientTotal)} /{" "}
              {formatCurrency(stackableLinePricing.partnerTotal)}
            </span>
          </div>
        </div>
      ) : null}

      {isHourly ? (
        <>
          <div className="grid grid-cols-3 gap-2 min-w-0">
            <div className="min-w-0">
              <PoundFieldLabel
                text="Client price"
                trailing={
                  !isStackablePricing && pricing ? (
                    <PricingSourceChip source={pricing.client.hourly_rate_source} />
                  ) : null
                }
              />
              <Input
                type="number"
                value={String(hourlyPreview.clientTotal + accessSurchargePreview)}
                readOnly
                className="bg-surface-hover/40 cursor-not-allowed"
                min="0"
                step="0.01"
              />
            </div>
            <div className="min-w-0">
              <PoundFieldLabel
                text="Partner cost"
                trailing={
                  !isStackablePricing && pricing ? (
                    <PricingSourceChip source={pricing.partner.hourly_partner_rate_source} />
                  ) : null
                }
              />
              <Input
                type="number"
                value={String(hourlyPreview.partnerTotal)}
                readOnly
                className="bg-surface-hover/40 cursor-not-allowed"
                min="0"
                step="0.01"
              />
            </div>
            <div className="min-w-0">
              <FieldLabel text="Min hours" hint={MIN_HOURS_HINT} />
              <Input
                type="number"
                value={form.billed_hours}
                onChange={(e) => update("billed_hours", e.target.value)}
                min="1"
                step="0.5"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 min-w-0">
            <div className="min-w-0">
              <PoundFieldLabel text="Client / h" hint={HOURLY_BILLING_HINT} />
              <Input
                type="number"
                value={form.hourly_client_rate}
                onChange={(e) => update("hourly_client_rate", e.target.value)}
                min="0"
                step="0.01"
              />
            </div>
            <div className="min-w-0">
              <PoundFieldLabel text="Partner / h" />
              <Input
                type="number"
                value={form.hourly_partner_rate}
                onChange={(e) => update("hourly_partner_rate", e.target.value)}
                min="0"
                step="0.01"
              />
            </div>
          </div>
        </>
      ) : (
        <div
          className={cn(
            "grid gap-2 min-w-0",
            form.materials_cost != null ? "grid-cols-3" : "grid-cols-2",
          )}
        >
          <div className="min-w-0">
            <PoundFieldLabel
              text="Client price"
              hint={FIXED_PRICING_HINT}
              trailing={
                !isStackablePricing && pricing ? (
                  <PricingSourceChip source={pricing.client.fixed_price_source} />
                ) : null
              }
            />
            <Input
              type="number"
              value={form.client_price}
              onChange={isStackablePricing ? undefined : (e) => update("client_price", e.target.value)}
              readOnly={isStackablePricing}
              className={cn(isStackablePricing && "bg-surface-hover/40 cursor-not-allowed")}
              min="0"
              step="0.01"
            />
          </div>
          <div className="min-w-0">
            <PoundFieldLabel text="Partner cost" trailing={marginChip} />
            <Input
              type="number"
              value={form.partner_cost}
              onChange={isStackablePricing ? undefined : (e) => update("partner_cost", e.target.value)}
              readOnly={isStackablePricing}
              className={cn(isStackablePricing && "bg-surface-hover/40 cursor-not-allowed")}
              min="0"
              step="0.01"
            />
          </div>
          {form.materials_cost != null ? (
            <div className="min-w-0">
              <PoundFieldLabel text="Materials" />
              <Input
                type="number"
                value={form.materials_cost}
                onChange={(e) => update("materials_cost", e.target.value)}
                min="0"
                step="0.01"
              />
            </div>
          ) : null}
        </div>
      )}

      {(stackablePricingLoading || pricingResolving) && !isStackablePricing ? (
        <p className="text-[11px] text-text-tertiary">Loading catalogue pricing…</p>
      ) : null}
    </div>
  );
}

export function JobCreateModalPricingModal({
  open,
  onClose,
  ...props
}: JobCreateModalPricingFieldsProps & { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pricing"
      subtitle="Client, partner and hourly rates"
      size="compact"
      rootClassName="z-[60]"
    >
      <div className="px-5 py-4 space-y-4">
        <JobCreateModalPricingFields {...props} />
        <div className="flex justify-end pt-1">
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Compact summary row (optional pencil in-row). */
export function JobCreateModalPricingControl(
  props: JobCreateModalPricingFieldsProps & {
    showPencil?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  },
) {
  const { showPencil = true, open: controlledOpen, onOpenChange, ...fieldProps } = props;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  return (
    <>
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border-light/80 bg-surface-hover/30 px-2.5 py-2 min-w-0">
        <JobCreateModalPricingSummary {...fieldProps} />
        {showPencil ? <JobCreateModalPricingPencil onClick={() => setOpen(true)} /> : null}
      </div>
      <JobCreateModalPricingModal open={open} onClose={() => setOpen(false)} {...fieldProps} />
    </>
  );
}
