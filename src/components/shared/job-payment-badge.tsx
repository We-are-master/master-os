"use client";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { JOB_PAYMENT_LABEL, type JobPaymentState } from "@/lib/job-payment-badge";

const VARIANT: Record<JobPaymentState, BadgeVariant> = {
  paid: "success",
  partial: "warning",
  overdue: "danger",
  awaiting: "default",
};

/** Rótulo da coluna Payment do Jobs Management (ver `jobPaymentState`). */
export function JobPaymentBadge({ state, size = "sm" }: { state: JobPaymentState; size?: "sm" | "md" }) {
  return (
    <Badge variant={VARIANT[state]} size={size}>
      {JOB_PAYMENT_LABEL[state]}
    </Badge>
  );
}
