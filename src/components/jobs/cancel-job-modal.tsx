"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useFrontendSetup } from "@/hooks/use-frontend-setup";
import { useCancelJob } from "@/hooks/use-cancel-job";
import {
  OFFICE_JOB_CANCELLATION_REASONS,
  officeCancellationDetailRequired,
} from "@/lib/job-office-cancellation";
import type { Job } from "@/types/database";

type Props = {
  jobId: string;
  jobReference?: string;
  isOpen: boolean;
  onClose: () => void;
  /** Fired after the cancel succeeds. Receives the updated row so callers can refresh derived state. */
  onCancelled?: (updated: Job) => void;
};

/** Inner body — kept separate so each open mounts a fresh component (auto-resets local state). */
function CancelJobModalBody({
  jobId,
  jobReference,
  onClose,
  onCancelled,
}: Pick<Props, "jobId" | "jobReference" | "onClose" | "onCancelled">) {
  const { officeCancellationPresets } = useFrontendSetup();
  const { submit, isSubmitting } = useCancelJob();
  const [presetId, setPresetId] = useState<string>(
    () => officeCancellationPresets[0]?.id ?? OFFICE_JOB_CANCELLATION_REASONS[0].id,
  );
  const [detail, setDetail] = useState("");

  const detailRequired = officeCancellationDetailRequired(presetId);

  const handleSubmit = async () => {
    const result = await submit({
      jobId,
      presetId,
      detail,
      presets: officeCancellationPresets,
    });
    if (result.ok) {
      onCancelled?.(result.updated);
      onClose();
    }
  };

  return (
    <Modal
      open
      onClose={() => {
        if (!isSubmitting) onClose();
      }}
      title="Cancel job"
      subtitle={jobReference}
    >
      <div className="p-4 space-y-4">
        <p className="text-sm text-text-secondary">
          The assigned partner will be notified with the reason below. The same note stays on this job for your team.
        </p>
        <p className="text-xs text-text-tertiary rounded-lg border border-border bg-muted/15 px-3 py-2">
          Charges or partner payouts after a cancel belong in Finance Summary — use{" "}
          <strong className="text-text-secondary">Add extra charge</strong> or{" "}
          <strong className="text-text-secondary">Add extra payout</strong> rather than cancelling with a dedicated fee flow.
        </p>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Reason</label>
          <select
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
            className="w-full h-10 rounded-lg border border-border bg-card text-sm text-text-primary px-3"
            disabled={isSubmitting}
          >
            {officeCancellationPresets.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">
            {detailRequired ? "Details (required)" : "Additional details (optional)"}
          </label>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={3}
            placeholder={
              detailRequired
                ? "Describe why this job is being cancelled…"
                : "Optional context for the partner or internal record…"
            }
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/15 resize-y min-h-[72px]"
            disabled={isSubmitting}
          />
        </div>
        <div className="flex flex-wrap gap-2 justify-end pt-1">
          <Button variant="ghost" size="sm" disabled={isSubmitting} onClick={onClose}>
            Back
          </Button>
          <Button variant="danger" size="sm" loading={isSubmitting} onClick={() => void handleSubmit()}>
            Cancel job
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function CancelJobModal(props: Props) {
  if (!props.isOpen) return null;
  return (
    <CancelJobModalBody
      jobId={props.jobId}
      jobReference={props.jobReference}
      onClose={props.onClose}
      onCancelled={props.onCancelled}
    />
  );
}
