import type { Job } from "@/types/database";
import { canMarkJobCompletedFinancially, type JobCompletionPaymentRow } from "@/lib/job-financials";
import { isJobOperationalSchemaEnabled } from "@/lib/job-schema-compat";
import { reportHealth } from "@/lib/report-health";
import { pickReportTemplate, type ReportTemplate } from "@/lib/public-report-templates";
import { isReportTemplate } from "@/lib/report-submission";
import type { LucideIcon } from "lucide-react";
import {
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  ShieldCheck,
  XCircle,
  Send,
} from "lucide-react";

/**
 * @deprecated mig 162 — phase system removed. The constants stay exported as 1
 * (was 1) and 2 (was 2/3) so existing callers don't crash, but new code should
 * not reference them. Multi-step flows are now via job_visits (mig 161).
 */
export const JOB_PHASE_COUNT_MIN = 1;
/** @deprecated mig 162 — phase system removed. */
export const JOB_PHASE_COUNT_MAX = 2;

/** DB statuses grouped under the "In progress" tab / column. After mig 162 just one in-progress + final_check. */
export const JOB_IN_PROGRESS_STATUSES: readonly Job["status"][] = [
  "in_progress",
  "final_check",
] as const;

/** Partner on site only — final check has its own Job Management tab. */
export const JOB_ONSITE_PROGRESS_STATUSES: readonly Job["status"][] = [
  "in_progress",
] as const;

export function isJobInProgressStatus(status: Job["status"]): boolean {
  return (JOB_IN_PROGRESS_STATUSES as readonly string[]).includes(status);
}

/**
 * @deprecated mig 162 — phase column kept for legacy reads. Returns 1 by default.
 */
export function normalizeTotalPhases(_n: number | undefined | null): 1 | 2 {
  // Phase system removed — always treat as single phase.
  return 1;
}

/**
 * @deprecated mig 162 — returns the single in_progress status now.
 */
export function lastInProgressStatusForTotal(_totalPhases: number): Job["status"] {
  return "in_progress";
}

/**
 * Reports flow now uses start_report + final_report (JSONB cols) directly.
 * The legacy report_1/2/3_uploaded/approved boolean fields are deprecated but
 * still read for backwards compat — if any are present and approved, treat as
 * "configured reports approved".
 */
export function allConfiguredReportsApproved(job: Job): boolean {
  // V2 (mig 162+): a job is "report-validated" once the final_report JSONB is
  // present AND has been approved by an internal user (final_report_approved_at).
  // The start_report is informational and does not gate completion.
  const hasFinalReport =
    !!job.final_report && Object.keys(job.final_report as Record<string, unknown>).length > 0;
  const finalApprovedAt = (job as { final_report_approved_at?: string | null }).final_report_approved_at;
  if (hasFinalReport && finalApprovedAt) return true;
  // Legacy pre-mig-162 jobs only have the boolean flag.
  return Boolean(job.report_1_approved);
}

/**
 * Which report template a job's envelopes were written in.
 *
 * Reads what was actually typed before falling back to the title, for the same
 * reason Stefane does: a report written in the flat template has no per-room
 * fields, and judging it by the title would demand answers the form never asked
 * for. Mirrors `templateDoReport` in `src/lib/stefane/run-external-report.ts`.
 */
function reportTemplateForJob(job: Job): ReportTemplate {
  for (const r of [job.final_report, job.start_report]) {
    const t = (r as { template?: unknown } | null)?.template;
    if (typeof t === "string" && isReportTemplate(t)) return t;
  }
  return pickReportTemplate({ title: String(job.title ?? "") });
}

/**
 * No finalising without a report that is actually filled in.
 *
 * The rule was always the operation's, and was never in the code: until now,
 * being in Final check was enough to advance, even with no report at all. What
 * measures "filled in" is `reportHealth`, against what the client's platform
 * really demands, and only the items it marks as blocking count here. Cleaning
 * jobs are not asked for prose, certificate jobs are not asked for before
 * photos, because the health check already knows that.
 *
 * The way out, when a partner does not use the app, is the office typing it in
 * `POST /api/jobs/[id]/office-report`. The report has to exist; whose keyboard
 * it came from does not matter.
 */
export function reportCompletionGate(job: Job): { ok: boolean; message?: string } {
  const health = reportHealth({
    template: reportTemplateForJob(job),
    startReport: job.start_report,
    finalReport: job.final_report,
    finalReportSubmitted: job.final_report_submitted,
    timerStartedAt: job.partner_timer_started_at,
    timerEndedAt: job.partner_timer_ended_at,
  });
  if (!health.bloqueado) return { ok: true };
  // Name what is missing, not just that something is: this message is read by
  // the person who can still fix it, with the job open in front of them.
  const missing = health.pendencias
    .filter((p) => p.bloqueia)
    .map((p) => p.rotulo.toLowerCase())
    .join(", ");
  return {
    ok: false,
    message: `Report is not complete yet: ${missing}. Ask the partner, or type it in from Office report.`,
  };
}

/**
 * Did this patch just approve the report?
 *
 * The signal for handing the report to the client's platform. Both approval
 * paths on the job page end in `buildJobReviewApprovalPatch`, so watching its
 * output catches them all, and any path added later, without the caller having
 * to remember to fire anything.
 *
 * Deliberately reads the patch and not the merged row: a row that was already
 * approved yesterday would fire again on every unrelated save.
 */
export function jobPatchApprovesReport(patch: Partial<Job>): boolean {
  return patch.report_1_approved === true || patch.internal_report_approved === true;
}

/** Header actions that need custom handling on the job detail page (e.g. send + invoice flow). */
export type JobStatusActionSpecial = "send_report_invoice" | "put_on_hold" | "resume_job";

export type JobStatusAction = {
  label: string;
  status: Job["status"];
  icon: LucideIcon;
  primary: boolean;
  destructive?: boolean;
  special?: JobStatusActionSpecial;
  /** Optional button styling on job detail (Complete = success, On Hold = dark red outline). */
  tone?: "success" | "hold";
};

/** Primary actions for advancing / rewinding job workflow. After mig 162: scheduled → in_progress → final_check → awaiting_payment → completed. */
export function getJobStatusActions(job: Job): JobStatusAction[] {
  const onHoldAction: JobStatusAction = {
    label: "On Hold",
    status: "on_hold",
    icon: Pause,
    primary: false,
    tone: "hold",
    special: "put_on_hold",
  };
  const cancelAction: JobStatusAction = {
    label: "Cancel Job",
    status: "cancelled",
    icon: XCircle,
    primary: false,
    destructive: true,
  };

  switch (job.status) {
    case "unassigned":
    case "auto_assigning":
      return [onHoldAction, cancelAction];
    case "scheduled":
    case "late":
      return [
        {
          label: "Start Job",
          status: "in_progress",
          icon: Play,
          primary: true,
        },
        onHoldAction,
        cancelAction,
      ];
    case "in_progress": {
      return [
        {
          label: "Job completed",
          status: "final_check",
          icon: CheckCircle2,
          primary: true,
          tone: "success",
        },
        onHoldAction,
        cancelAction,
      ];
    }
    case "final_check": {
      return [
        {
          label: "Review & Approve",
          status: "awaiting_payment",
          icon: Send,
          primary: true,
          special: "send_report_invoice",
        },
        onHoldAction,
        { label: "Reopen Job", status: "in_progress", icon: RotateCcw, primary: false },
        cancelAction,
      ];
    }
    case "awaiting_payment":
      return [
        { label: "Mark as Paid", status: "completed", icon: CheckCircle2, primary: true },
        onHoldAction,
        cancelAction,
      ];
    case "need_attention":
      return [
        { label: "Validate & complete", status: "completed", icon: ShieldCheck, primary: true },
        {
          label: "Back to In progress",
          status: "in_progress",
          icon: RotateCcw,
          primary: false,
        },
        onHoldAction,
        cancelAction,
      ];
    case "completed":
      return [{ label: "Reopen", status: "scheduled", icon: RotateCcw, primary: false }];
    case "cancelled": {
      const reopenTarget: Job["status"] =
        job.partner_id || job.partner_name?.trim() ? "scheduled" : "unassigned";
      return [{ label: "Reopen Job", status: reopenTarget, icon: RotateCcw, primary: false }];
    }
    case "on_hold":
      return [
        {
          label: "Resume job",
          status: "in_progress",
          icon: Play,
          primary: true,
          special: "resume_job",
        },
        cancelAction,
      ];
    default:
      return [];
  }
}

export type JobAdvanceFinancialContext = {
  customerPayments: JobCompletionPaymentRow[];
  partnerPayments: JobCompletionPaymentRow[];
};

/**
 * Previous step in the main office workflow (for Rewind / Back on job cards).
 * Returns null when there is no earlier step (e.g. unassigned, cancelled).
 */
export function getPreviousJobStatus(job: Job): Job["status"] | null {
  switch (job.status) {
    case "deleted":
    case "cancelled":
    case "on_hold":
    case "unassigned":
      return null;
    case "auto_assigning":
      return "unassigned";
    case "completed":
      return "awaiting_payment";
    case "awaiting_payment":
      return "final_check";
    case "need_attention":
      return "in_progress";
    case "final_check":
      return "in_progress";
    case "in_progress":
      return "scheduled";
    case "late":
      return "scheduled";
    case "scheduled":
      return "unassigned";
    default:
      return null;
  }
}

export function isRewindTransition(job: Job, nextStatus: string): boolean {
  const prev = getPreviousJobStatus(job);
  return prev !== null && nextStatus === prev;
}

export function canAdvanceJob(
  job: Job,
  nextStatus: string,
  financialCtx?: JobAdvanceFinancialContext,
): { ok: boolean; message?: string } {
  if (job.status === "deleted") {
    return { ok: false, message: "This job is in Deleted. Recover it from Jobs → Deleted first." };
  }

  if (isRewindTransition(job, nextStatus)) {
    return { ok: true };
  }

  if (nextStatus === "on_hold") {
    if (job.status === "cancelled" || job.status === "completed" || job.status === "on_hold") {
      return { ok: false, message: "On hold is not available for this status." };
    }
    return { ok: true };
  }

  if (job.status === "on_hold") {
    if (nextStatus === "cancelled") return { ok: true };
    const prev = (job.on_hold_previous_status ?? "").trim() as Job["status"];
    if (prev && nextStatus === prev && isJobOnSiteWorkStatus(prev)) return { ok: true };
    return { ok: false, message: "Use Resume job to continue from on hold." };
  }

  if (nextStatus === "cancelled") {
    return { ok: true };
  }

  if (nextStatus === "in_progress") {
    if (job.status === "final_check") {
      return { ok: true };
    }
    if (!job.partner_id && !job.partner_name?.trim()) return { ok: false, message: "Assign a partner before starting the job." };
    if (!job.scheduled_date && !job.scheduled_start_at) return { ok: false, message: "Set scheduled date before starting the job." };
  }
  if (nextStatus === "final_check") {
    if (!isJobOnSiteWorkStatus(job.status)) {
      return { ok: false, message: "Move to Final Check from the on-site (In progress) step." };
    }
    return { ok: true };
  }
  if (nextStatus === "awaiting_payment") {
    const filled = reportCompletionGate(job);
    if (!filled.ok) return filled;
    if (allConfiguredReportsApproved(job)) return { ok: true };
    if (job.status === "final_check") return { ok: true };
    return { ok: false, message: "Ops must approve the report before Awaiting Payment." };
  }

  if (nextStatus === "completed") {
    if (!financialCtx) {
      return {
        ok: false,
        message:
          "Open this job to verify payments. Completed is only allowed when customer and partner amounts are fully collected/paid out.",
      };
    }
    return canMarkJobCompletedFinancially(
      job,
      financialCtx.customerPayments,
      financialCtx.partnerPayments,
    );
  }

  return { ok: true };
}

/**
 * @deprecated mig 162 — phase system removed. Returns [1] for back-compat;
 * UI should not loop over phases anymore.
 */
export function reportPhaseIndices(_totalPhases: number): number[] {
  return [1];
}

/**
 * @deprecated mig 162 — phase system removed. Returns single label.
 */
export function reportPhaseLabel(_phaseIndex: number, _totalPhases: number): string {
  return "Job report";
}

/** Monotonic workflow order for gating report actions (higher = further along). */
export function jobStatusRank(status: Job["status"]): number {
  switch (status) {
    case "unassigned":
    case "auto_assigning":
    case "scheduled":
    case "late":
      return 0;
    case "on_hold":
      return 10;
    case "in_progress":
      return 20;
    case "need_attention":
      return 35;
    case "final_check":
      return 40;
    case "awaiting_payment":
      return 50;
    case "completed":
      return 100;
    case "cancelled":
      return 1;
    default:
      return 0;
  }
}

/**
 * @deprecated mig 162 — phase report slots removed. The function is kept for
 * legacy callers; returns 999 (gate everything off) for slots > 1 since we
 * no longer surface them in the UI.
 */
export function minimumStatusRankForReportSlot(reportSlotIndex: number, _totalPhases: number): number {
  if (reportSlotIndex !== 1) return 999;
  return 20; // in_progress+
}

export function canMarkReportUploaded(job: Job, reportSlotIndex: number): { ok: boolean; message?: string } {
  if (job.status === "cancelled") {
    return { ok: false, message: "Job is cancelled." };
  }
  if (job.status === "on_hold") {
    return { ok: false, message: "Job is on hold — resume before updating reports." };
  }
  if (job.status === "completed") {
    return { ok: false, message: "Job is completed — reports are locked." };
  }
  if (reportSlotIndex !== 1) {
    return { ok: false, message: "Phase reports were removed — use the single Job report instead." };
  }
  if (jobStatusRank(job.status) < 20) {
    return {
      ok: false,
      message: "Start Job before marking the report as uploaded.",
    };
  }
  return { ok: true };
}

export function canApproveReport(job: Job, reportSlotIndex: number): { ok: boolean; message?: string } {
  const gate = canMarkReportUploaded(job, reportSlotIndex);
  if (!gate.ok) return gate;
  const uploaded = job[`report_${reportSlotIndex}_uploaded` as keyof Job] as boolean;
  if (!uploaded) {
    return { ok: false, message: "The report must be uploaded before it can be approved." };
  }
  if (job[`report_${reportSlotIndex}_approved` as keyof Job] as boolean) {
    return { ok: false, message: "This report is already approved." };
  }
  return { ok: true };
}

/**
 * After report is approved, customer / final payment step only from Final Check
 * (avoids skipping on-site work while still on Scheduled).
 */
export function canSendReportAndRequestFinalPayment(job: Job): { ok: boolean; message?: string } {
  // Same gate as advancing, and it matters more here: this is the step that puts
  // a report and an invoice in the client's hands. Being in Final check used to
  // be enough on its own, which meant an empty report could be emailed out.
  const filled = reportCompletionGate(job);
  if (!filled.ok) return filled;
  if (allConfiguredReportsApproved(job)) {
    if (job.status !== "final_check" && !isJobOnSiteWorkStatus(job.status)) {
      return {
        ok: false,
        message: "Job must be in Final check or on site before sending the report and invoice.",
      };
    }
    return { ok: true };
  }
  if (job.status === "final_check") {
    return { ok: true };
  }
  if (isJobOnSiteWorkStatus(job.status)) {
    return { ok: false, message: "Report must be uploaded and approved first." };
  }
  return { ok: false, message: "Report must be uploaded and approved first." };
}

/** True while partner is doing on-site work (not final check / payment). */
export function isJobOnSiteWorkStatus(status: Job["status"]): boolean {
  return status === "in_progress";
}

const JOB_SCHEDULE_PATCH_KEYS = [
  "scheduled_date",
  "scheduled_start_at",
  "scheduled_end_at",
  "scheduled_finish_date",
] as const;

export function jobPatchTouchesSchedule(patch: Record<string, unknown>): boolean {
  return JOB_SCHEDULE_PATCH_KEYS.some((k) => Object.prototype.hasOwnProperty.call(patch, k));
}

/** Office reschedule: move post-visit pipeline steps back to Booked (`scheduled`). */
const STATUSES_RESET_TO_SCHEDULED_ON_RESCHEDULE = new Set<Job["status"]>([
  "late",
  "in_progress",
  "final_check",
  "awaiting_payment",
  "need_attention",
]);

/** Merge `status: scheduled` when the patch changes schedule and the job was past Booked. */
export function applyOfficeRescheduleStatus(
  beforeStatus: Job["status"],
  patch: Record<string, unknown>,
): Record<string, unknown> {
  if (!jobPatchTouchesSchedule(patch)) return patch;
  if (!STATUSES_RESET_TO_SCHEDULED_ON_RESCHEDULE.has(beforeStatus)) return patch;
  return { ...patch, status: "scheduled" };
}

/** After on hold, restore the step the job was on (scheduled/late vs on-site phases). */
export function jobStatusAfterResumeFromOnHold(
  previous: Job["status"] | string | null | undefined,
): Job["status"] {
  const p = String(previous ?? "in_progress").trim() as Job["status"];
  if (isJobOnSiteWorkStatus(p)) return p;
  if (p === "scheduled" || p === "late") return p;
  if (p === "final_check" || p === "need_attention") return p;
  return "in_progress";
}

/**
 * Persist review/approval flags on `jobs` using columns that exist in migration 070 + 011.
 * Do not use `report_submitted` — that field is not on Postgres and causes PostgREST 400.
 */
export function buildJobReviewApprovalPatch(opts?: {
  submittedAt?: string;
  reviewSentAt?: string;
  reviewSendMethod?: "email" | "manual";
}): Partial<Job> {
  const ts = opts?.submittedAt ?? new Date().toISOString();
  const legacy: Partial<Job> = {
    report_1_uploaded: true,
    report_1_approved: true,
    report_1_approved_at: ts,
  };
  if (!isJobOperationalSchemaEnabled()) {
    return legacy;
  }
  return {
    final_report_submitted: true,
    internal_report_approved: true,
    internal_invoice_approved: true,
    ...legacy,
    ...(opts?.reviewSentAt ? { review_sent_at: opts.reviewSentAt } : {}),
    ...(opts?.reviewSendMethod ? { review_send_method: opts.reviewSendMethod } : {}),
  };
}

/** When ops validates the last report, move to final_check and stop the on-site timer in the same update. */
export function shouldAutoAdvanceToFinalCheckAfterMerge(
  merged: Job,
  updates: Partial<Job>,
  statusBefore: Job["status"],
): boolean {
  if (updates.status !== undefined) return false;
  // Trigger when report_1 is being approved on a job currently on-site.
  const touchedApprove =
    updates.report_1_approved !== undefined ||
    updates.report_1_approved_at !== undefined;
  if (!touchedApprove) return false;
  if (!allConfiguredReportsApproved(merged)) return false;
  if (!isJobOnSiteWorkStatus(merged.status)) return false;
  if (statusBefore === "final_check") return false;
  return true;
}
