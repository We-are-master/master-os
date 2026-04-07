import type { Job } from "@/types/database";
import { formatJobScheduleLine } from "@/lib/schedule-calendar";

type JobPushScheduleFields = Pick<
  Job,
  "scheduled_date" | "scheduled_start_at" | "scheduled_end_at" | "scheduled_finish_date"
>;

/**
 * Partner push for generic `handleJobUpdate` patches should fire only when something
 * material to the field partner changes — not on every office edit (notes, images, owner, client price, etc.).
 */
const PARTNER_PUSH_WORTHY_KEYS = new Set<string>([
  "scheduled_date",
  "scheduled_start_at",
  "scheduled_end_at",
  "scheduled_finish_date",
  "property_address",
  "latitude",
  "longitude",
  "partner_cost",
  "partner_agreed_value",
  "hourly_partner_rate",
  "scope",
]);

/**
 * Assignment changes always notify (handled separately as job_assigned / job_unassigned).
 * Otherwise notify only if at least one partner-relevant field is in the patch.
 */
export function shouldNotifyPartnerForJobPatch(updates: Partial<Job>): boolean {
  const keys = Object.keys(updates).filter((k) => updates[k as keyof Job] !== undefined);
  if (keys.length === 0) return false;
  if (keys.some((k) => k === "partner_id" || k === "partner_ids")) return true;
  return keys.some((k) => PARTNER_PUSH_WORTHY_KEYS.has(k));
}

export type PartnerJobPushKind =
  | "job_updated"
  | "job_assigned"
  | "job_unassigned"
  | "job_status_changed"
  | "job_cancelled_by_office";

export function notifyAssignedPartnerAboutJob(options: {
  partnerId: string;
  job: Pick<Job, "id" | "reference" | "title" | "property_address" | "status"> & JobPushScheduleFields;
  kind: PartnerJobPushKind;
  statusLabel?: string;
  /** Shown in push body when the office cancels (same text as `jobs.cancellation_reason`). */
  cancellationReason?: string;
}): void {
  const { partnerId, job, kind, statusLabel, cancellationReason } = options;
  if (typeof window === "undefined" || !partnerId) return;
  const head = [job.reference, job.title].filter(Boolean).join(" · ") || "Job";
  const loc = job.property_address ? ` · ${job.property_address}` : "";
  const schedLine = formatJobScheduleLine(job);
  const schedSuffix = schedLine ? `\n${schedLine}` : "";

  let title: string;
  let body: string;
  switch (kind) {
    case "job_assigned":
      title = "Job assigned";
      body = `${head}${loc}${schedSuffix}`;
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
