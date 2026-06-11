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
import { resolveOfficeCancelFeeDefaults, type OfficeCancelFeeDefaults } from "@/lib/office-cancel-fees";
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

type CancelFault = "partner" | "account" | "custom";

type Props = {
  jobId: string;
  jobReference?: string;
  jobHint?: JobCancelHint | null;
  isOpen: boolean;
  onClose: () => void;
  onCancelled?: (updated: Job) => void;
};

function formatGbpInput(n: number | null | undefined): string {
  if (n == null || !(n > 0)) return "";
  return String(Math.round(n * 100) / 100);
}

function applyFaultPreset(
  fault: CancelFault,
  defaults: OfficeCancelFeeDefaults,
  hasClient: boolean,
  hasPartner: boolean,
): {
  chargeClient: boolean;
  clientFeeInput: string;
  partnerFee: boolean;
  partnerFlow: "owes" | "paid";
  partnerFeeInput: string;
} {
  if (fault === "partner") {
    return {
      chargeClient: hasClient && defaults.clientFeeGbp != null,
      clientFeeInput: formatGbpInput(defaults.clientFeeGbp),
      partnerFee: hasPartner && defaults.partnerOwesFeeGbp != null,
      partnerFlow: "owes",
      partnerFeeInput: formatGbpInput(defaults.partnerOwesFeeGbp),
    };
  }
  if (fault === "account") {
    return {
      chargeClient: hasClient,
      clientFeeInput: formatGbpInput(defaults.accountFaultClientChargeGbp),
      partnerFee: hasPartner,
      partnerFlow: "paid",
      partnerFeeInput: formatGbpInput(defaults.accountFaultPartnerCompGbp),
    };
  }
  return {
    chargeClient: false,
    clientFeeInput: "",
    partnerFee: false,
    partnerFlow: "owes",
    partnerFeeInput: "",
  };
}

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
  const [feeDefaults, setFeeDefaults] = useState<OfficeCancelFeeDefaults | null>(null);
  const [cancelFault, setCancelFault] = useState<CancelFault>("partner");
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
      if (cancelled) return;
      setFeeDefaults(defaults);
      const hasClient = Boolean(j.client_id?.trim() || j.client_name?.trim());
      const hasPartner = jobHasPartnerSet(j);
      const preset = applyFaultPreset("partner", defaults, hasClient, hasPartner);
      setChargeClient(preset.chargeClient);
      setClientFeeInput(preset.clientFeeInput);
      setPartnerFee(preset.partnerFee);
      setPartnerFlow(preset.partnerFlow);
      setPartnerFeeInput(preset.partnerFeeInput);
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

  const handleFaultChange = (fault: CancelFault) => {
    setCancelFault(fault);
    if (!feeDefaults) return;
    const preset = applyFaultPreset(fault, feeDefaults, hasClient, hasPartner);
    setChargeClient(preset.chargeClient);
    setClientFeeInput(preset.clientFeeInput);
    setPartnerFee(preset.partnerFee);
    setPartnerFlow(preset.partnerFlow);
    setPartnerFeeInput(preset.partnerFeeInput);
  };

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
      cancellationFault: cancelFault,
    });
    if (result.ok) {
      onCancelled?.(result.updated);
      onClose();
    }
  };

  const clientFeeLabel =
    cancelFault === "partner"
      ? "Amount account charges Fixfy (£)"
      : cancelFault === "account"
        ? "Charge account (£)"
        : "Amount (£)";

  const partnerFeeLabel =
    cancelFault === "partner"
      ? "Deduct from partner on self-bill (£)"
      : cancelFault === "account"
        ? "Pay partner compensation (£)"
        : "Amount (£)";

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
              the reason below.
            </>
          ) : isAutoAssigning ? (
            <>This job is still in <strong className="text-text-primary">auto-assign</strong> — partners are not notified.</>
          ) : (
            <>No partner assigned. The cancellation reason stays on this job for your team.</>
          )}
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
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary resize-y min-h-[72px]"
            disabled={isSubmitting}
          />
        </div>

        {(hasClient || hasPartner) && (
          <div className="rounded-lg border border-border p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Who is at fault?</p>
            <div className="flex flex-col gap-2 text-sm">
              {(
                [
                  ["partner", "Partner fault — account charges Fixfy; deduct from partner"],
                  ["account", "Account fault — pay partner; charge account"],
                  ["custom", "Custom — set fees manually"],
                ] as const
              ).map(([id, label]) => (
                <label key={id} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="cancelFault"
                    checked={cancelFault === id}
                    onChange={() => handleFaultChange(id)}
                    disabled={isSubmitting}
                    className="mt-0.5"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {hasClient && (
          <div className="rounded-lg border border-border p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
              <input
                type="checkbox"
                checked={chargeClient}
                onChange={(e) => setChargeClient(e.target.checked)}
                disabled={isSubmitting || cancelFault !== "custom"}
                className="rounded border-border"
              />
              {cancelFault === "partner" ? "Account charges Fixfy (invoice)" : "Charge account / client fee"}
            </label>
            {chargeClient && (
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">{clientFeeLabel}</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={clientFeeInput}
                  onChange={(e) => setClientFeeInput(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full h-10 rounded-lg border border-border bg-card text-sm px-3"
                />
              </div>
            )}
          </div>
        )}

        {hasPartner && (
          <div className="rounded-lg border border-border p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
              <input
                type="checkbox"
                checked={partnerFee}
                onChange={(e) => setPartnerFee(e.target.checked)}
                disabled={isSubmitting || cancelFault !== "custom"}
                className="rounded border-border"
              />
              Partner fee on self-bill
              {partnerLabel ? <span className="text-text-tertiary font-normal">({partnerLabel})</span> : null}
            </label>
            {partnerFee && (
              <div className="space-y-2">
                {cancelFault === "custom" && (
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
                )}
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">{partnerFeeLabel}</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={partnerFeeInput}
                    onChange={(e) => setPartnerFeeInput(e.target.value)}
                    disabled={isSubmitting}
                    className="w-full h-10 rounded-lg border border-border bg-card text-sm px-3"
                  />
                  {cancelFault === "partner" ? (
                    <p className="text-[11px] text-text-tertiary mt-1">
                      Shown on self-bill as (Cancelled - Fee Applied) and reduces net payout.
                    </p>
                  ) : null}
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
