import { formatJobScheduleLine } from "@/lib/schedule-calendar";
import { notifyAssignedPartnerAboutJob } from "@/lib/notify-partner-job-push";
import { notifyPartnerJobChange } from "@/lib/notify-partner-job-zendesk";
import { notifyClientReschedule } from "@/lib/notify-client-reschedule";
import { updateJob } from "@/services/jobs";
import type { Job } from "@/types/database";

/**
 * Moving a job's date is one business process: save the new window, then tell
 * the partner and the client what changed. It lived only inside the Jobs detail
 * page, so anywhere else that changed a date moved it silently and the partner
 * turned up on the old day.
 *
 * The client leg is deliberately separate from the partner leg: the partner is
 * always told, the client depends on `CLIENT_MESSAGING_ENABLED` and on the
 * account's own policy.
 */

export type RescheduleInput = {
  /** YYYY-MM-DD. */
  date: string;
  /** ISO instants for the arrival window. Null clears the window. */
  startAt: string | null;
  endAt: string | null;
  /** Shown to the client when the account allows the message. */
  reason?: string | null;
};

export async function rescheduleJob(job: Job, input: RescheduleInput): Promise<Job> {
  const date = input.date.trim();
  if (!date) throw new Error("Pick a date before rescheduling.");

  const patch: Partial<Job> = {
    scheduled_date: date,
    scheduled_start_at: input.startAt ?? undefined,
    scheduled_end_at: input.endAt ?? undefined,
  };

  const oldDateLine = formatJobScheduleLine(job) || "Previously scheduled";
  const updated = await updateJob(job.id, patch);
  const newDateLine = formatJobScheduleLine(updated) || "New schedule";

  // Nothing actually moved — don't send anyone a "we changed the date" message.
  if (oldDateLine === newDateLine) return updated;

  if (updated.partner_id) {
    notifyAssignedPartnerAboutJob({ partnerId: updated.partner_id, job: updated, kind: "job_updated" });
    void notifyPartnerJobChange({
      jobId: updated.id,
      jobReference: updated.reference,
      kind: "rescheduled",
      oldDateLine,
      oldTimeLine: null,
      newDateLine,
      newTimeLine: null,
      skipPush: true, // the push above already went out
    });
  }

  void notifyClientReschedule({
    jobId: updated.id,
    oldDateLine,
    newDateLine,
    reason: input.reason ?? null,
  });

  return updated;
}
