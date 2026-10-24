"use client";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { HoverPreview } from "@/components/ui/hover-preview";
import { JOB_PAYMENT_LABEL, type JobPaymentDetail, type JobPaymentState } from "@/lib/job-payment-badge";

const VARIANT: Record<JobPaymentState, BadgeVariant> = {
  paid: "success",
  partial: "warning",
  unpaid: "default",
  deposit_pending: "warning",
  overdue: "danger",
  card_declined: "danger",
  card_failed: "danger",
  bank_check: "danger",
};

/**
 * Rótulo da coluna Payment do Jobs Management (ver `jobPaymentState`). Com
 * `detail`, o hover mostra quanto entrou, a fatura, o vencimento e, no cartão,
 * o motivo da recusa e a tentativa.
 */
export function JobPaymentBadge({
  state,
  detail,
  size = "sm",
  className,
}: {
  state: JobPaymentState;
  detail?: JobPaymentDetail | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const badge = (
    <Badge variant={VARIANT[state]} size={size} className={className}>
      {JOB_PAYMENT_LABEL[state]}
    </Badge>
  );
  if (!detail) return badge;
  return (
    <HoverPreview content={<JobPaymentCard state={state} detail={detail} />} openDelayMs={200} className="inline-flex">
      {badge}
    </HoverPreview>
  );
}

function JobPaymentCard({ state, detail }: { state: JobPaymentState; detail: JobPaymentDetail }) {
  return (
    <div className="space-y-2.5">
      <div className="space-y-1.5">
        <Badge variant={VARIANT[state]} size="sm">{JOB_PAYMENT_LABEL[state]}</Badge>
        <p className="m-0 text-[12px] font-medium leading-snug text-text-primary">{detail.headline}</p>
      </div>
      {detail.rows.length ? (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
          {detail.rows.map((r) => (
            <div key={r.label} className="contents">
              <dt className="text-text-tertiary">{r.label}</dt>
              <dd className="m-0 text-right font-medium tabular-nums text-text-primary">{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
