import type { Job } from "@/types/database";
import type { LucideIcon } from "lucide-react";
import {
  Play,
  Pause,
  TrendingUp,
  RotateCcw,
  CheckCircle2,
  CreditCard,
  ShieldCheck,
} from "lucide-react";

export const JOB_PHASE_COUNT_MIN = 1;
export const JOB_PHASE_COUNT_MAX = 3;

/** Clamp to 1–3 (matches report_1…report_3 slots). */
export function normalizeTotalPhases(n: number | undefined | null): 1 | 2 | 3 {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return 3;
  return Math.min(JOB_PHASE_COUNT_MAX, Math.max(JOB_PHASE_COUNT_MIN, x)) as 1 | 2 | 3;
}

export function lastInProgressStatusForTotal(totalPhases: number): Job["status"] {
  const tp = normalizeTotalPhases(totalPhases);
  if (tp <= 1) return "in_progress_phase1";
  if (tp === 2) return "in_progress_phase2";
  return "in_progress_phase3";
}

export type JobStatusAction = {
  label: string;
  status: Job["status"];
  icon: LucideIcon;
  primary: boolean;
};

/** Primary actions for advancing / rewinding job workflow, respecting `total_phases`. */
export function getJobStatusActions(job: Job): JobStatusAction[] {
  const tp = normalizeTotalPhases(job.total_phases);
  const last = lastInProgressStatusForTotal(tp);

  switch (job.status) {
    case "scheduled":
      return [{ label: "Start Phase 1", status: "in_progress_phase1", icon: Play, primary: true }];
    case "in_progress_phase1":
      if (tp <= 1) {
        return [
          { label: "Final Check", status: "final_check", icon: CheckCircle2, primary: true },
          { label: "Pause", status: "scheduled", icon: Pause, primary: false },
        ];
      }
      return [
        { label: "Advance to Phase 2", status: "in_progress_phase2", icon: TrendingUp, primary: true },
        { label: "Pause", status: "scheduled", icon: Pause, primary: false },
      ];
    case "in_progress_phase2":
      if (tp <= 2) {
        return [
          { label: "Final Check", status: "final_check", icon: CheckCircle2, primary: true },
          { label: "Back to Phase 1", status: "in_progress_phase1", icon: RotateCcw, primary: false },
        ];
      }
      return [
        { label: "Advance to Phase 3", status: "in_progress_phase3", icon: TrendingUp, primary: true },
        { label: "Back to Phase 1", status: "in_progress_phase1", icon: RotateCcw, primary: false },
      ];
    case "in_progress_phase3":
      return [
        { label: "Final Check", status: "final_check", icon: CheckCircle2, primary: true },
        { label: "Back to Phase 2", status: "in_progress_phase2", icon: RotateCcw, primary: false },
      ];
    case "final_check": {
      const backLabel = tp === 1 ? "Back to Phase 1" : tp === 2 ? "Back to Phase 2" : "Back to Phase 3";
      return [
        { label: "Awaiting Payment", status: "awaiting_payment", icon: CreditCard, primary: true },
        { label: backLabel, status: last, icon: RotateCcw, primary: false },
      ];
    }
    case "awaiting_payment":
      return [{ label: "Mark Completed", status: "completed", icon: CheckCircle2, primary: true }];
    case "need_attention":
      return [
        { label: "Validate & complete", status: "completed", icon: ShieldCheck, primary: true },
        {
          label: tp === 1 ? "Back to Phase 1" : tp === 2 ? "Back to Phase 2" : "Back to Phase 3",
          status: last,
          icon: RotateCcw,
          primary: false,
        },
      ];
    case "completed":
      return [{ label: "Reopen", status: "scheduled", icon: RotateCcw, primary: false }];
    default:
      return [];
  }
}

export function canAdvanceJob(job: Job, nextStatus: string): { ok: boolean; message?: string } {
  const tp = normalizeTotalPhases(job.total_phases);

  if (nextStatus === "in_progress_phase2" && tp < 2) {
    return { ok: false, message: "This job is configured for only one phase." };
  }
  if (nextStatus === "in_progress_phase3" && tp < 3) {
    return { ok: false, message: "This job does not include a third phase." };
  }

  if (nextStatus === "in_progress_phase1") {
    if (!job.partner_id && !job.partner_name?.trim()) return { ok: false, message: "Assign a partner before starting the job." };
    if (!job.scheduled_date && !job.scheduled_start_at) return { ok: false, message: "Set scheduled date before starting the job." };
  }
  if (nextStatus === "final_check") {
    let hasReport = false;
    for (let n = 1; n <= tp; n++) {
      if (job[`report_${n}_uploaded` as keyof Job]) {
        hasReport = true;
        break;
      }
    }
    if (!hasReport) return { ok: false, message: "Upload at least one post-job report/photo before Final Check." };
  }
  if (nextStatus === "awaiting_payment") {
    let approved = false;
    for (let n = 1; n <= tp; n++) {
      if (job[`report_${n}_approved` as keyof Job]) {
        approved = true;
        break;
      }
    }
    if (!approved) return { ok: false, message: "Ops must approve at least one report before Awaiting Payment." };
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
  if (phaseIndex === 2) return tp === 2 ? "Report 2 — job complete" : "Report 2 — Mid progress";
  return "Report 3 — Final";
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
