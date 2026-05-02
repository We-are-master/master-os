/**
 * Client-side helper to fire the Zendesk side-conversation email for a job
 * and surface a single toast with both push + zendesk status.
 *
 * Push is sent in this same call (via the API route) UNLESS skipPush=true,
 * in which case the caller is responsible for the push (e.g. they already
 * called notifyAssignedPartnerAboutJob).
 */

import { toast } from "sonner";

export type NotifyPartnerJobChangeKind =
  | "assigned"
  | "status_changed"
  | "cancelled"
  | "on_hold"
  | "resumed"
  | "completed"
  | "rescheduled";

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

interface ApiResult {
  ok: boolean;
  kind?: NotifyPartnerJobChangeKind;
  push?: { ok: boolean; tokens_sent: number; error: string | null };
  zendesk?: { ok: boolean; side_conversation_id?: string | null; error?: string | null; skipped?: string };
  skipped?: string;
}

export async function notifyPartnerJobChange(opts: NotifyPartnerJobChangeOptions): Promise<ApiResult> {
  const { jobId, jobReference, kind, reason, newStatusLabel, oldDateLine, oldTimeLine, newDateLine, newTimeLine, skipPush, silent } = opts;
  const refLabel = jobReference ? ` ${jobReference}` : "";

  let result: ApiResult = { ok: false };
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
    result = (await res.json().catch(() => ({ ok: false }))) as ApiResult;
  } catch (err) {
    console.error("[notify-partner-job-change] fetch failed:", err);
    if (!silent) toast.error(`Could not notify partner about${refLabel}`);
    return { ok: false };
  }

  if (silent) return result;

  // No partner / no ticket / job missing → quiet skip
  if (result.skipped === "no_partner") return result;
  if (result.skipped === "partner_not_found") {
    toast.info(`Partner not found — nothing to send for${refLabel}`);
    return result;
  }

  // Build a single toast that surfaces BOTH channels
  const pushBit = (() => {
    if (skipPush) return null;
    if (!result.push) return null;
    if (result.push.ok) return `Push ✓ (${result.push.tokens_sent})`;
    if (result.push.error === "no_push_token") return "Push — no token";
    return `Push ✗ ${result.push.error ?? ""}`;
  })();

  const zdBit = (() => {
    if (!result.zendesk) return null;
    if (result.zendesk.skipped === "not_a_zendesk_job") return null; // silent for non-Zendesk jobs
    if (result.zendesk.ok) return result.zendesk.side_conversation_id ? "Zendesk ✓ side conv" : "Zendesk ✓";
    if (result.zendesk.error === "partner_has_no_email") return "Zendesk — no partner email";
    return `Zendesk ✗ ${result.zendesk.error ?? ""}`;
  })();

  const parts = [pushBit, zdBit].filter((s): s is string => Boolean(s));
  if (parts.length === 0) return result;

  const allOk =
    (skipPush || (result.push?.ok ?? false)) &&
    (result.zendesk?.skipped === "not_a_zendesk_job" || (result.zendesk?.ok ?? true));

  const summary = `Partner notified${refLabel}: ${parts.join(" · ")}`;
  if (allOk) toast.success(summary);
  else toast.warning(summary);
  return result;
}
