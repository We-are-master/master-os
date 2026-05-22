/**
 * Client-side helper to fire the Zendesk side-conversation email for a job
 * and surface a single toast with both push + zendesk status.
 *
 * Push is sent in this same call (via the API route) UNLESS skipPush=true,
 * in which case the caller is responsible for the push (e.g. they already
 * called notifyAssignedPartnerAboutJob).
 */

import { toast } from "sonner";
import {
  buildPartnerNotifyToastContent,
  type PartnerNotifyApiResult,
} from "@/lib/partner-notification-toast";

export type NotifyPartnerJobChangeKind =
  | "assigned"
  | "status_changed"
  | "cancelled"
  | "on_hold"
  | "resumed"
  | "completed"
  | "rescheduled"
  | "confirmation_request"
  | "booked";

export interface NotifyPartnerJobChangeOptions {
  jobId: string;
  jobReference?: string;
  kind: NotifyPartnerJobChangeKind;
  reason?: string | null;
  /** Human-readable status label (e.g. "On Hold"). Falls back to job.status. */
  newStatusLabel?: string;
  /** When kind = "rescheduled", side-by-side comparison values. */
  oldDateLine?: string;
  oldTimeLine?: string | null;
  newDateLine?: string;
  newTimeLine?: string | null;
  /** Skip the push send (caller already did it via notifyAssignedPartnerAboutJob). */
  skipPush?: boolean;
  /** When true, no toast — useful when you want silent best-effort firing. */
  silent?: boolean;
}

export async function notifyPartnerJobChange(opts: NotifyPartnerJobChangeOptions): Promise<PartnerNotifyApiResult> {
  const {
    jobId,
    jobReference,
    kind,
    reason,
    newStatusLabel,
    oldDateLine,
    oldTimeLine,
    newDateLine,
    newTimeLine,
    skipPush,
    silent,
  } = opts;
  const refLabel = jobReference ? ` ${jobReference}` : "";

  let result: PartnerNotifyApiResult = { ok: false };
  try {
    const res = await fetch(`/api/jobs/${jobId}/notify-partner-zendesk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        reason: reason ?? null,
        newStatusLabel: newStatusLabel ?? null,
        oldDateLine: oldDateLine ?? null,
        oldTimeLine: oldTimeLine ?? null,
        newDateLine: newDateLine ?? null,
        newTimeLine: newTimeLine ?? null,
        skipPush: skipPush ?? false,
      }),
    });
    result = (await res.json().catch(() => ({ ok: false }))) as PartnerNotifyApiResult;
  } catch (err) {
    console.error("[notify-partner-job-change] fetch failed:", err);
    if (!silent) {
      toast.error(`Couldn't reach the partner${refLabel}`, {
        description: "Something broke on our side. Try again, or call the partner yourself.",
      });
    }
    return { ok: false };
  }

  if (silent) return result;

  const content = buildPartnerNotifyToastContent(result, { jobReference, skipPush });
  if (!content) return result;

  const toastOpts = { description: content.description };
  switch (content.level) {
    case "success":
      toast.success(content.title, toastOpts);
      break;
    case "warning":
      toast.warning(content.title, toastOpts);
      break;
    case "info":
      toast.info(content.title, toastOpts);
      break;
    case "error":
      toast.error(content.title, toastOpts);
      break;
  }
  return result;
}
