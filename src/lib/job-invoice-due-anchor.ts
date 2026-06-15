import {
  dueDateIsoFromAccountPaymentTerms,
  type AccountPaymentOrgContext,
} from "@/lib/account-payment-due-date";
import {
  DUE_ON_RECEIPT_HOURS,
  dueDateIsoAfterHours,
  isDueOnReceiptTerms,
} from "@/lib/invoice-payment-terms";
import type { JobKind } from "@/types/database";

export type JobScheduleAnchorInput = {
  job_kind?: JobKind | null;
  scheduled_date?: string | null;
  scheduled_start_at?: string | null;
};

/** Prefer timed schedule start; fall back to calendar scheduled_date at local noon. */
export function resolveJobScheduleInstant(job: JobScheduleAnchorInput): Date | null {
  const startAt = job.scheduled_start_at?.trim();
  if (startAt) {
    const d = new Date(startAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const sched = job.scheduled_date?.trim().slice(0, 10) ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(sched)) {
    return new Date(`${sched}T12:00:00`);
  }
  return null;
}

export function shouldUseDueOnReceiptOneOffRule(
  paymentTerms: string | null | undefined,
  jobKind: JobKind | null | undefined,
): boolean {
  return jobKind === "one_off" && isDueOnReceiptTerms(paymentTerms);
}

/** One-off Due on Receipt: expected receipt = scheduled finish + 72h. */
export function dueDateIsoForDueOnReceiptOneOff(scheduleAnchor: Date): string {
  return dueDateIsoAfterHours(scheduleAnchor, DUE_ON_RECEIPT_HOURS);
}

export function dueDateIsoForJobAccountTerms(
  baseDate: Date,
  paymentTerms: string | null | undefined,
  orgCtx: AccountPaymentOrgContext | null | undefined,
  options?: { jobKind?: JobKind | null; scheduleAnchor?: Date | null },
): string {
  if (
    shouldUseDueOnReceiptOneOffRule(paymentTerms, options?.jobKind) &&
    options?.scheduleAnchor
  ) {
    return dueDateIsoForDueOnReceiptOneOff(options.scheduleAnchor);
  }
  return dueDateIsoFromAccountPaymentTerms(baseDate, paymentTerms, orgCtx);
}
