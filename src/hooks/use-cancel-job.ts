"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { Job } from "@/types/database";
import { getJob, updateJob } from "@/services/jobs";
import { logAudit } from "@/services/audit";
import { useProfile } from "@/hooks/use-profile";
import { type OfficeJobCancellationPresetRow } from "@/lib/frontend-setup";
import {
  buildOfficeCancellationReasonText,
  officeCancellationDetailRequired,
} from "@/lib/job-office-cancellation";
import {
  buildCancellationFeeJobPatch,
  patchOfficeCancelLostSnapshot,
  patchOfficeCancelZeroJobEconomics,
  type OfficeCancelFeeChoices,
} from "@/lib/job-cancel-economics";
import { applyOfficeCancellationFees } from "@/lib/office-cancel-fees";
import { clearAutoAssignQueuePatch } from "@/lib/job-partner-assign";
import { statusChangePartnerTimerPatch } from "@/lib/partner-live-timer";
import { statusChangeOfficeTimerPatch } from "@/lib/office-job-timer";
import { notifyAssignedPartnerAboutJob } from "@/lib/notify-partner-job-push";
import { notifyPartnerJobChange } from "@/lib/notify-partner-job-zendesk";
import { syncJobZendeskCancellationFields } from "@/lib/zendesk-job-cancellation-sync";
import { postgrestFullErrorText } from "@/lib/supabase-schema-compat";
import { getErrorMessage } from "@/lib/utils";

export type { OfficeCancelFeeChoices };

export type CancelJobInput = {
  /** Job id to cancel. Hook will fetch the latest row to read pre-cancel economics + timer state. */
  jobId: string;
  /** Preset id from `officeCancellationPresets`. */
  presetId: string;
  /** Free-text detail (required when preset === "other"). */
  detail: string;
  /** Resolved presets list (passed in to keep the hook framework-agnostic). */
  presets: readonly OfficeJobCancellationPresetRow[];
  /** Optional cancellation fee rails (client invoice + partner self-bill). */
  fees?: OfficeCancelFeeChoices;
  /** Fault preset for audit (mig 237). */
  cancellationFault?: "partner" | "account" | "custom" | null;
};

export type CancelJobResult =
  | { ok: true; updated: Job }
  | { ok: false; error: string };

function feeAuditSummary(fees: OfficeCancelFeeChoices | undefined): string {
  if (!fees) return "Job cancelled — labour zeroed; no cancellation fees.";
  const parts: string[] = [];
  if (fees.chargeClient && fees.clientFeeGbp != null && fees.clientFeeGbp > 0) {
    parts.push(`client fee £${fees.clientFeeGbp.toFixed(2)}`);
  }
  if (fees.partnerFee && fees.partnerFeeGbp != null && fees.partnerFeeGbp > 0) {
    parts.push(
      fees.partnerFlow === "paid"
        ? `partner payout £${fees.partnerFeeGbp.toFixed(2)}`
        : `partner clawback £${fees.partnerFeeGbp.toFixed(2)}`,
    );
  }
  if (parts.length === 0) return "Job cancelled — labour zeroed; no cancellation fees.";
  return `Job cancelled — labour zeroed; ${parts.join("; ")} (invoice/self-bill finalized).`;
}

/**
 * Encapsulates the office-side cancel flow: validation, lost-revenue snapshot,
 * timer resets, status change, fee docs, audit log, and partner notification.
 */
export function useCancelJob() {
  const { profile } = useProfile();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = useCallback(
    async (input: CancelJobInput): Promise<CancelJobResult> => {
      if (officeCancellationDetailRequired(input.presetId) && !input.detail.trim()) {
        const msg = 'Add details when the reason is "Other".';
        toast.error(msg);
        return { ok: false, error: msg };
      }

      const reasonText = buildOfficeCancellationReasonText(
        input.presetId,
        input.detail,
        input.presets,
      );

      setIsSubmitting(true);
      try {
        const currentJob = await getJob(input.jobId);
        if (!currentJob) {
          const msg = "Job not found";
          toast.error(msg);
          return { ok: false, error: msg };
        }

        const now = new Date().toISOString();
        const feePatch = input.fees ? buildCancellationFeeJobPatch(input.fees) : {};
        const patch: Partial<Job> = {
          ...patchOfficeCancelZeroJobEconomics(),
          ...patchOfficeCancelLostSnapshot(currentJob),
          ...clearAutoAssignQueuePatch(),
          ...feePatch,
          status: "cancelled",
          cancellation_reason: reasonText,
          cancellation_fault: input.cancellationFault ?? null,
          cancelled_at: now,
          cancelled_by: profile?.id ?? null,
          ...statusChangePartnerTimerPatch(currentJob, "cancelled"),
          ...statusChangeOfficeTimerPatch(currentJob, "cancelled"),
        };

        const priorInvoiceId = currentJob.invoice_id;
        const priorSelfBillId = currentJob.self_bill_id;

        let updated = await updateJob(input.jobId, patch, {
          skipSelfBillSync: true,
          skipCancelDocVoid: true,
        });

        updated = await applyOfficeCancellationFees({
          job: updated,
          cancellationReason: reasonText,
          priorInvoiceId,
          priorSelfBillId,
        });

        void fetch(`/api/jobs/${encodeURIComponent(updated.id)}/auto-assign-cancel-cleanup`, {
          method: "POST",
        }).catch((err) => console.error("[use-cancel-job] auto-assign cleanup:", err));

        await logAudit({
          entityType: "job",
          entityId: updated.id,
          entityRef: updated.reference,
          action: "status_changed",
          fieldName: "status",
          oldValue: currentJob.status,
          newValue: "cancelled",
          userId: profile?.id,
          userName: profile?.full_name,
        });
        await logAudit({
          entityType: "job",
          entityId: updated.id,
          entityRef: updated.reference,
          action: "updated",
          fieldName: "financial_documents",
          newValue: feeAuditSummary(input.fees),
          userId: profile?.id,
          userName: profile?.full_name,
        });

        if (updated.partner_id) {
          notifyAssignedPartnerAboutJob({
            partnerId: updated.partner_id,
            job: updated,
            kind: "job_cancelled_by_office",
            cancellationReason: reasonText,
          });
          void notifyPartnerJobChange({
            jobId: updated.id,
            jobReference: updated.reference,
            kind: "cancelled",
            reason: reasonText,
            newStatusLabel: "Cancelled",
            skipPush: true,
          });
        }

        void syncJobZendeskCancellationFields(updated.id, {
          presetId: input.presetId,
          notes: input.detail.trim() || null,
        }).catch((err) => console.error("[use-cancel-job] zendesk cancellation fields:", err));

        toast.success("Job cancelled");
        return { ok: true, updated };
      } catch (err) {
        const detail = postgrestFullErrorText(err).trim().replace(/\s+/g, " ");
        const msg = detail
          ? `Failed to cancel job — ${detail.slice(0, 450)}${detail.length > 450 ? "…" : ""}`
          : getErrorMessage(err, "Failed to cancel job");
        toast.error(msg);
        return { ok: false, error: msg };
      } finally {
        setIsSubmitting(false);
      }
    },
    [profile?.id, profile?.full_name],
  );

  return { submit, isSubmitting };
}
