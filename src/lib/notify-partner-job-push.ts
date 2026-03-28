import type { Job } from "@/types/database";

const PARTNER_IRRELEVANT_ONLY = new Set(["owner_id", "owner_name"]);

/** True when every touched field is internal (office owner) — partner does not need a push. */
export function updatesOnlyIrrelevantToPartner(updates: Partial<Job>): boolean {
  const keys = Object.keys(updates).filter((k) => updates[k as keyof Job] !== undefined);
  if (keys.length === 0) return true;
  return keys.every((k) => PARTNER_IRRELEVANT_ONLY.has(k));
}

export type PartnerJobPushKind =
  | "job_updated"
  | "job_assigned"
  | "job_unassigned"
  | "job_status_changed"
  | "job_cancelled_by_office";

export function notifyAssignedPartnerAboutJob(options: {
  partnerId: string;
  job: Pick<Job, "id" | "reference" | "title" | "property_address" | "status">;
  kind: PartnerJobPushKind;
  statusLabel?: string;
  /** Shown in push body when the office cancels (same text as `jobs.cancellation_reason`). */
  cancellationReason?: string;
}): void {
  const { partnerId, job, kind, statusLabel, cancellationReason } = options;
  if (typeof window === "undefined" || !partnerId) return;
  const head = [job.reference, job.title].filter(Boolean).join(" · ") || "Job";
  const loc = job.property_address ? ` · ${job.property_address}` : "";

  let title: string;
  let body: string;
  switch (kind) {
    case "job_assigned":
      title = "Job assigned";
      body = `${head}${loc}`;
      break;
    case "job_unassigned":
      title = "Job unassigned";
      body = `You were removed from ${head}${loc}`;
      break;
    case "job_cancelled_by_office": {
      const r = cancellationReason?.trim();
      title = "Job cancelled";
      body = r ? `${head}${loc}. Reason: ${r}` : `${head}${loc}. The office cancelled this job.`;
      break;
    }
    case "job_status_changed":
      title = "Job status updated";
      body = `${head}: ${statusLabel ?? job.status}${loc}`;
      break;
    default:
      title = "Job updated";
      body = `${head} was updated in the office${loc}`;
  }

  fetch("/api/push/notify-partner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      partnerId,
      title,
      body: body.slice(0, 500),
      data: {
        type: kind,
        jobId: job.id,
        ...(cancellationReason?.trim() ? { cancellationReason: cancellationReason.trim().slice(0, 400) } : {}),
      },
    }),
  }).catch(() => {});
}
