"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useFrontendSetup } from "@/hooks/use-frontend-setup";
import { useCancelJob, type OfficeCancelFeeChoices } from "@/hooks/use-cancel-job";
import {
  OFFICE_JOB_CANCELLATION_REASONS,
  officeCancellationDetailRequired,
} from "@/lib/job-office-cancellation";
import { jobHasPartnerSet } from "@/lib/job-partner-assign";
import { resolveOfficeCancelFeeDefaults } from "@/lib/office-cancel-fees";
import { getJob } from "@/services/jobs";
import type { Job } from "@/types/database";

type JobCancelHint = Pick<
  Job,
  | "id"
  | "client_id"
  | "client_name"
  | "partner_id"
  | "partner_ids"
  | "partner_name"
  | "status"
  | "auto_assign_invited_partner_ids"
>;

type Props = {
  jobId: string;
  jobReference?: string;
  /** Current job row from the detail/kanban page — avoids stale partner detection. */
  jobHint?: JobCancelHint | null;
  isOpen: boolean;
  onClose: () => void;
  /** Fired after the cancel succeeds. Receives the updated row so callers can refresh derived state. */
  onCancelled?: (updated: Job) => void;
};

function formatGbpInput(n: number | null | undefined): string {
  if (n == null || !(n > 0)) return "";
  return String(Math.round(n * 100) / 100);
}

/** Inner body — kept separate so each open mounts a fresh component (auto-resets local state). */
function CancelJobModalBody({
  jobId,
  jobReference,
  jobHint,
  onClose,
  onCancelled,
}: Pick<Props, "jobId" | "jobReference" | "jobHint" | "onClose" | "onCancelled">) {
  const { officeCancellationPresets } = useFrontendSetup();
  const { submit, isSubmitting } = useCancelJob();
  const [presetId, setPresetId] = useState<string>(
    () => officeCancellationPresets[0]?.id ?? OFFICE_JOB_CANCELLATION_REASONS[0].id,
  );
  const [detail, setDetail] = useState("");
  const [jobRow, setJobRow] = useState<Job | null>(null);
  const [chargeClient, setChargeClient] = useState(false);
  const [clientFeeInput, setClientFeeInput] = useState("");
  const [partnerFee, setPartnerFee] = useState(false);
  const [partnerFlow, setPartnerFlow] = useState<"owes" | "paid">("owes");
  const [partnerFeeInput, setPartnerFeeInput] = useState("");

  useEffect(() => {
    if (jobHint) setJobRow((prev) => (prev?.id === jobHint.id ? prev : ({ ...jobHint } as Job)));
  }, [jobHint]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const j = await getJob(jobId);
      if (cancelled || !j) return;
      setJobRow(j);
      const defaults = await resolveOfficeCancelFeeDefaults(j);
      if (defaults.clientFeeGbp != null) {
        setChargeClient(true);
        setClientFeeInput(formatGbpInput(defaults.clientFeeGbp));
      }
      if (jobHasPartnerSet(j) && defaults.partnerOwesFeeGbp != null) {
        setPartnerFee(true);
        setPartnerFlow("owes");
        setPartnerFeeInput(formatGbpInput(defaults.partnerOwesFeeGbp));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const detailRequired = officeCancellationDetailRequired(presetId);
  const displayJob = jobRow ?? (jobHint as Job | null);
  const hasClient = Boolean(displayJob?.client_id?.trim() || displayJob?.client_name?.trim());
  const hasPartner = displayJob ? jobHasPartnerSet(displayJob) : false;
  const isAutoAssigning =
    displayJob?.status === "auto_assigning" ||
    (Array.isArray(displayJob?.auto_assign_invited_partner_ids) &&
      (displayJob.auto_assign_invited_partner_ids?.length ?? 0) > 0);
  const partnerLabel = displayJob?.partner_name?.trim() || null;

  const buildFees = (): OfficeCancelFeeChoices => {
    const clientGbp = chargeClient && clientFeeInput.trim() ? Number(clientFeeInput) : null;
    const partnerGbp = partnerFee && partnerFeeInput.trim() ? Number(partnerFeeInput) : null;
    return {
      chargeClient,
      clientFeeGbp: Number.isFinite(clientGbp) && (clientGbp ?? 0) > 0 ? clientGbp : null,
      partnerFee,
      partnerFlow: partnerFee ? partnerFlow : null,
      partnerFeeGbp: Number.isFinite(partnerGbp) && (partnerGbp ?? 0) > 0 ? partnerGbp : null,
    };
  };

  const handleSubmit = async () => {
    const fees = buildFees();
    const result = await submit({
      jobId,
      presetId,
      detail,
      presets: officeCancellationPresets,
      fees,
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
          {hasPartner ? (
            <>
              <strong className="text-text-primary">{partnerLabel ?? "Assigned partner"}</strong> will be notified with
              the reason below. The same note stays on this job for your team.
            </>
          ) : isAutoAssigning ? (
            <>
              This job is still in <strong className="text-text-primary">auto-assign</strong> — no partner has accepted
              yet, so invited partners are not notified. The cancellation reason stays on this job for your team.
            </>
          ) : (
            <>
              No partner is assigned on this job. The cancellation reason stays on this job for your team.
            </>
          )}
        </p>
        <p className="text-xs text-text-tertiary rounded-lg border border-border bg-muted/15 px-3 py-2">
          Labour and open invoices/self-bills are zeroed and voided. Optional cancellation fees below are finalized
          immediately (invoice pending / self-bill awaiting payment) — same as Review &amp; approve, without the review
          modal.
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

        {hasClient && (
          <div className="rounded-lg border border-border p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
              <input
                type="checkbox"
                checked={chargeClient}
                onChange={(e) => setChargeClient(e.target.checked)}
                disabled={isSubmitting}
                className="rounded border-border"
              />
              Charge client a cancellation fee
            </label>
            {chargeClient && (
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Amount (£)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={clientFeeInput}
                  onChange={(e) => setClientFeeInput(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full h-10 rounded-lg border border-border bg-card text-sm px-3"
                  placeholder="0.00"
                />
              </div>
            )}
          </div>
        )}

        {!hasPartner && (hasClient || isAutoAssigning) && (
          <p className="text-xs text-text-tertiary rounded-lg border border-dashed border-border px-3 py-2">
            Partner cancellation fee (self-bill) is only available once a partner has been assigned or has accepted the
            job — not while the job is unassigned or waiting on auto-assign offers.
          </p>
        )}

        {hasPartner && (
          <div className="rounded-lg border border-border p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
              <input
                type="checkbox"
                checked={partnerFee}
                onChange={(e) => setPartnerFee(e.target.checked)}
                disabled={isSubmitting}
                className="rounded border-border"
              />
              Partner cancellation fee
              {partnerLabel ? (
                <span className="text-text-tertiary font-normal">({partnerLabel})</span>
              ) : null}
            </label>
            {partnerFee && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-3 text-sm">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="partnerFlow"
                      checked={partnerFlow === "owes"}
                      onChange={() => setPartnerFlow("owes")}
                      disabled={isSubmitting}
                    />
                    Partner owes Fixfy
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="partnerFlow"
                      checked={partnerFlow === "paid"}
                      onChange={() => setPartnerFlow("paid")}
                      disabled={isSubmitting}
                    />
                    Fixfy pays partner
                  </label>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Amount (£)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={partnerFeeInput}
                    onChange={(e) => setPartnerFeeInput(e.target.value)}
                    disabled={isSubmitting}
                    className="w-full h-10 rounded-lg border border-border bg-card text-sm px-3"
                    placeholder="0.00"
                  />
                </div>
              </div>
            )}
          </div>
        )}

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
      jobHint={props.jobHint}
      onClose={props.onClose}
      onCancelled={props.onCancelled}
    />
  );
}
