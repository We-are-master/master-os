import type { Job } from "@/types/database";
import { canMarkJobCompletedFinancially, type JobCompletionPaymentRow } from "@/lib/job-financials";
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

export const JOB_PHASE_COUNT_MIN = 1;
export const JOB_PHASE_COUNT_MAX = 2;

/** DB statuses grouped under the "In progress" tab / column (phases + final check). */
export const JOB_IN_PROGRESS_STATUSES: readonly Job["status"][] = [
  "in_progress_phase1",
  "in_progress_phase2",
  "in_progress_phase3",
  "final_check",
] as const;

/** Partner on site only — final check has its own Job Management tab. */
export const JOB_ONSITE_PROGRESS_STATUSES: readonly Job["status"][] = [
  "in_progress_phase1",
  "in_progress_phase2",
  "in_progress_phase3",
] as const;

export function isJobInProgressStatus(status: Job["status"]): boolean {
  return (JOB_IN_PROGRESS_STATUSES as readonly string[]).includes(status);
}

/** Clamp to 1–2 (matches report_1…report_2 slots). */
export function normalizeTotalPhases(n: number | undefined | null): 1 | 2 {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return 2;
  return Math.min(JOB_PHASE_COUNT_MAX, Math.max(JOB_PHASE_COUNT_MIN, x)) as 1 | 2;
}

export function lastInProgressStatusForTotal(totalPhases: number): Job["status"] {
  // With the new model, the workflow stays "In progress" while reports are collected.
  // So we always go back to Phase 1 (the in-progress work state).
  return "in_progress_phase1";
}

export function allConfiguredReportsApproved(job: Job): boolean {
  const tp = normalizeTotalPhases(job.total_phases);
  for (let n = 1; n <= tp; n++) {
    const uploaded = job[`report_${n}_uploaded` as keyof Job] as boolean;
    const approved = job[`report_${n}_approved` as keyof Job] as boolean;
    if (!uploaded || !approved) return false;
  }
  return true;
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

/** Primary actions for advancing / rewinding job workflow, respecting `total_phases`. */
export function getJobStatusActions(job: Job): JobStatusAction[] {
  const tp = normalizeTotalPhases(job.total_phases);
  const last = lastInProgressStatusForTotal(tp);
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
      return [cancelAction];
    case "scheduled":
    case "late":
      return [
        {
          label: "Start Job",
          status: "in_progress_phase1",
          icon: Play,
          primary: true,
        },
        {
          label: "On Hold",
          status: "on_hold",
          icon: Pause,
          primary: false,
          tone: "hold",
          special: "put_on_hold",
        },
        cancelAction,
      ];
    case "in_progress_phase1":
    case "in_progress_phase2":
    case "in_progress_phase3": {
      return [
        {
          label: "Complete Job",
          status: "final_check",
          icon: CheckCircle2,
          primary: true,
          tone: "success",
        },
        {
          label: "On Hold",
          status: "on_hold",
          icon: Pause,
          primary: false,
          tone: "hold",
          special: "put_on_hold",
        },
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
        { label: "Reopen Job", status: last, icon: RotateCcw, primary: false },
        cancelAction,
      ];
    }
    case "awaiting_payment":
      return [
        { label: "Mark as Paid", status: "completed", icon: CheckCircle2, primary: true },
        cancelAction,
      ];
    case "need_attention":
      return [
        { label: "Validate & complete", status: "completed", icon: ShieldCheck, primary: true },
        {
          label: "Back to Phase 1",
          status: last,
          icon: RotateCcw,
          primary: false,
        },
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
          status: "in_progress_phase1",
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
  const tp = normalizeTotalPhases(job.total_phases);
  const last = lastInProgressStatusForTotal(tp);
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
      return last;
    case "final_check":
      return last;
    case "in_progress_phase3":
      if (tp >= 3) return "in_progress_phase2";
      if (tp === 2) return "in_progress_phase1";
      return "scheduled";
    case "in_progress_phase2":
      if (tp >= 2) return "in_progress_phase1";
      return "scheduled";
    case "in_progress_phase1":
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
  const tp = normalizeTotalPhases(job.total_phases);

  if (job.status === "deleted") {
    return { ok: false, message: "This job is in Deleted. Recover it from Jobs → Deleted first." };
  }

  if (isRewindTransition(job, nextStatus)) {
    return { ok: true };
  }

  if (nextStatus === "on_hold") {
    if (isJobOnSiteWorkStatus(job.status)) return { ok: true };
    return { ok: false, message: "On hold is only available while the job is in progress on site." };
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

  if (nextStatus === "in_progress_phase2" && tp < 2) {
    return { ok: false, message: "This job is configured for only one phase." };
  }
  if (nextStatus === "in_progress_phase3" && tp < 3) {
    return { ok: false, message: "This job does not include a third phase." };
  }

  if (nextStatus === "in_progress_phase1") {
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
    let allApproved = true;
    for (let n = 1; n <= tp; n++) {
      if (!job[`report_${n}_approved` as keyof Job]) { allApproved = false; break; }
    }
    if (allApproved) return { ok: true };
    if (job.status === "final_check") return { ok: true };
    return { ok: false, message: "Ops must approve all reports before Awaiting Payment." };
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

export function reportPhaseIndices(totalPhases: number): number[] {
  const tp = normalizeTotalPhases(totalPhases);
  return Array.from({ length: tp }, (_, i) => i + 1);
}

export function reportPhaseLabel(phaseIndex: number, totalPhases: number): string {
  const tp = normalizeTotalPhases(totalPhases);
  if (tp === 1) return "Report — job complete";
  if (phaseIndex === 1) return "Report 1 — Start & progress";
  return "Report 2 — job complete";
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
    case "in_progress_phase1":
      return 10;
    case "in_progress_phase2":
      return 20;
    case "in_progress_phase3":
      return 30;
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

/** Minimum workflow rank required to record report slot N (aligned with start/end). */
export function minimumStatusRankForReportSlot(reportSlotIndex: number, totalPhases: number): number {
  const tp = normalizeTotalPhases(totalPhases);
  if (reportSlotIndex < 1 || reportSlotIndex > tp) return 999;
  if (reportSlotIndex === 1) return 10; // in_progress_phase1+
  if (reportSlotIndex === 2) return 10; // report_2 is also allowed while job stays in in_progress_phase1
  return 30;
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
  const tp = normalizeTotalPhases(job.total_phases);
  if (reportSlotIndex < 1 || reportSlotIndex > tp) {
    return { ok: false, message: "Invalid report step." };
  }
  const minRank = minimumStatusRankForReportSlot(reportSlotIndex, tp);
  if (jobStatusRank(job.status) < minRank) {
    return {
      ok: false,
      message: "Start Job before marking this report as uploaded.",
    };
  }
  if (reportSlotIndex > 1) {
    const prevUploaded = job[`report_${reportSlotIndex - 1}_uploaded` as keyof Job] as boolean;
    if (!prevUploaded) {
      return { ok: false, message: `Mark report ${reportSlotIndex - 1} as uploaded first.` };
    }
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
  if (reportSlotIndex > 1) {
    const prevApproved = job[`report_${reportSlotIndex - 1}_approved` as keyof Job] as boolean;
    if (!prevApproved) {
      return { ok: false, message: `Approve report ${reportSlotIndex - 1} first.` };
    }
  }
  return { ok: true };
}

/**
 * After all reports are approved, customer / final payment step only from Final Check
 * (avoids skipping on-site work while still on Scheduled).
 */
export function canSendReportAndRequestFinalPayment(job: Job): { ok: boolean; message?: string } {
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
    return { ok: false, message: "All reports must be uploaded and approved first." };
  }
  return { ok: false, message: "All reports must be uploaded and approved first." };
}

/** True while partner is doing on-site work (not final check / payment). */
export function isJobOnSiteWorkStatus(status: Job["status"]): boolean {
  return status === "in_progress_phase1" || status === "in_progress_phase2" || status === "in_progress_phase3";
}

/** After on hold, restore the step the job was on (scheduled/late vs on-site phases). */
export function jobStatusAfterResumeFromOnHold(
  previous: Job["status"] | string | null | undefined,
): Job["status"] {
  const p = String(previous ?? "in_progress_phase1").trim() as Job["status"];
  if (isJobOnSiteWorkStatus(p)) return p;
  if (p === "scheduled" || p === "late") return p;
  if (p === "final_check" || p === "need_attention") return p;
  return "in_progress_phase1";
}

/** When ops validates the last report, move to final_check and stop the on-site timer in the same update. */
export function shouldAutoAdvanceToFinalCheckAfterMerge(
  merged: Job,
  updates: Partial<Job>,
  statusBefore: Job["status"],
): boolean {
  if (updates.status !== undefined) return false;
  const tp = normalizeTotalPhases(merged.total_phases);
  const touchedApprove = Array.from({ length: tp }, (_, i) => i + 1).some(
    (n) =>
      updates[`report_${n}_approved` as keyof Job] !== undefined ||
      updates[`report_${n}_approved_at` as keyof Job] !== undefined,
  );
  if (!touchedApprove) return false;
  if (!allConfiguredReportsApproved(merged)) return false;
  if (!isJobOnSiteWorkStatus(merged.status)) return false;
  if (statusBefore === "final_check") return false;
  return true;
}
