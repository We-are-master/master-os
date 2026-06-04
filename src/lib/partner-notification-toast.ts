/**
 * Plain-language copy for office → partner notifications (phone app + Zendesk email).
 */

import type { NotifyPartnerJobChangeKind } from "@/lib/notify-partner-job-zendesk";

export type PartnerNotifyApiResult = {
  ok?: boolean;
  kind?: NotifyPartnerJobChangeKind;
  skipped?: string;
  push?: { ok: boolean; tokens_sent: number; error: string | null };
  zendesk?: {
    ok: boolean;
    side_conversation_id?: string | null;
    error?: string | null;
    skipped?: string;
  };
};

export type PartnerNotifyToastLevel = "success" | "warning" | "info" | "error";

export type PartnerNotifyToastContent = {
  level: PartnerNotifyToastLevel;
  title: string;
  description: string;
};

const KIND_TITLE: Record<NotifyPartnerJobChangeKind, string> = {
  assigned:             "Partner assigned",
  status_changed:       "Status changed",
  cancelled:            "Job cancelled",
  on_hold:              "Job on hold",
  resumed:              "Job back on",
  completed:            "Job finished",
  rescheduled:          "Date changed",
  confirmation_request: "Confirmation requested",
  booked:               "Job booked",
};

/** Zendesk auto-email to partners (not policy-skipped). */
const ZENDESK_AUTO_EMAIL_KINDS = new Set<NotifyPartnerJobChangeKind>([
  "assigned",
  "booked",
  "completed",
  "confirmation_request",
  "cancelled",
  "on_hold",
]);

function jobRef(jobReference?: string): string {
  return jobReference?.trim() ? ` · ${jobReference.trim()}` : "";
}

function parsePolicySkip(error?: string | null, skipped?: string | null): NotifyPartnerJobChangeKind | null {
  const raw = skipped ?? error ?? "";
  const legacy = /^skipped_kind_(.+)$/.exec(raw);
  if (legacy) return legacy[1] as NotifyPartnerJobChangeKind;
  const modern = /^kind_(.+)$/.exec(raw);
  return modern ? (modern[1] as NotifyPartnerJobChangeKind) : null;
}

function titleFor(kind?: NotifyPartnerJobChangeKind): string {
  if (!kind) return "Partner update";
  return KIND_TITLE[kind] ?? "Partner update";
}

function pushStatus(result: PartnerNotifyApiResult, skipPush?: boolean): "sent" | "no_app" | "failed" | null {
  if (skipPush) return null;
  const push = result.push;
  if (!push) return null;
  if (push.ok) return "sent";
  if (push.error === "no_push_token") return "no_app";
  if (push.error === "skipped_by_caller") return null;
  return "failed";
}

function zendeskStatus(
  result: PartnerNotifyApiResult,
): "sent" | "policy_skip" | "no_email" | "failed" | "not_zendesk" | null {
  const zd = result.zendesk;
  if (!zd) return null;
  if (zd.skipped === "not_a_zendesk_job") return "not_zendesk";
  if (parsePolicySkip(zd.error, zd.skipped)) return "policy_skip";
  if (zd.ok) return "sent";
  if (zd.error === "partner_has_no_email") return "no_email";
  if (zd.error === "skipped") return null;
  return "failed";
}

function describePush(status: ReturnType<typeof pushStatus>): string | null {
  switch (status) {
    case "sent":
      return "Phone: they got a notification in the partner app.";
    case "no_app":
      return "Phone: not sent — they don't use the partner app on their phone.";
    case "failed":
      return "Phone: something went wrong — the ping didn't go through.";
    default:
      return null;
  }
}

function describeZendesk(status: ReturnType<typeof zendeskStatus>): string | null {
  switch (status) {
    case "sent":
      return "Email: sent from the Zendesk ticket.";
    case "policy_skip":
      return "Email: not sent — this update type does not trigger a partner email.";
    case "no_email":
      return "Email: not sent — this partner has no email saved.";
    case "failed":
      return "Email: didn't go through — you may need to message them in Zendesk yourself.";
    default:
      return null;
  }
}

function whatToDo(
  push: ReturnType<typeof pushStatus>,
  zd: ReturnType<typeof zendeskStatus>,
  kind?: NotifyPartnerJobChangeKind,
): string {
  if (zd === "no_email") {
    return "What to do: go to Partners, open their profile, add an email, then save again.";
  }
  if (zd === "failed") {
    return "What to do: open the Zendesk ticket and message the partner there.";
  }
  if (push === "failed" || push === "no_app") {
    return "What to do: call or text the partner so they know.";
  }
  if (zd === "policy_skip" && push === "sent") {
    return "What to do: ask them to check the partner app, or call to confirm.";
  }
  if (kind && ZENDESK_AUTO_EMAIL_KINDS.has(kind) && push === "sent" && zd === "sent") {
    return "All good — they should get the app ping and the email.";
  }
  if (push === "sent") {
    return "All good on the phone side.";
  }
  return "";
}

/**
 * Build title + description for a partner notification toast.
 */
export function buildPartnerNotifyToastContent(
  result: PartnerNotifyApiResult,
  opts?: { jobReference?: string; skipPush?: boolean },
): PartnerNotifyToastContent | null {
  const ref = jobRef(opts?.jobReference);
  const kind = result.kind;

  if (result.skipped === "no_partner") {
    return {
      level: "info",
      title: `No partner on this job${ref}`,
      description: "Nobody to notify yet. Pick a partner on the job if someone should know about this.",
    };
  }

  if (result.skipped === "partner_not_found") {
    return {
      level: "warning",
      title: `Partner not found${ref}`,
      description: "The partner linked to this job is missing. Choose another partner from the list.",
    };
  }

  const push = pushStatus(result, opts?.skipPush);
  const zd = zendeskStatus(result);
  const parts = [describePush(push), describeZendesk(zd)].filter((s): s is string => Boolean(s));

  if (parts.length === 0) return null;

  const action = whatToDo(push, zd, kind);
  const description = action ? `${parts.join("\n")}\n\n${action}` : parts.join("\n");

  const pushFailed = push === "failed";
  const zdFailed = zd === "failed" || zd === "no_email";
  const level: PartnerNotifyToastLevel = pushFailed || zdFailed ? "warning" : "success";

  return {
    level,
    title: `${titleFor(kind)}${ref}`,
    description,
  };
}

/** Tiny labels on Zendesk history pills. */
export function formatPushEventDetail(
  ok: boolean,
  tokensSent: number,
  error: string | null | undefined,
): string {
  if (ok) return tokensSent > 0 ? "Phone OK" : "Phone OK";
  if (!error) return "Phone failed";
  if (error === "no_push_token") return "No phone app";
  if (error === "skipped_by_caller") return "—";
  return "Phone failed";
}

export function isZendeskPolicySkip(error: string | null | undefined): boolean {
  if (!error) return false;
  return Boolean(parsePolicySkip(error, error));
}

export function zendeskEventPillOk(ok: boolean, error: string | null | undefined): boolean {
  return ok || isZendeskPolicySkip(error);
}

export function formatZendeskEventDetail(
  ok: boolean,
  error: string | null | undefined,
  eventKind?: string | null,
): string {
  if (ok) return "Email OK";
  if (isZendeskPolicySkip(error)) return "No auto-email";
  if (error === "partner_has_no_email") return "No email saved";
  if (error === "skipped" || !error) {
    return eventKind && ZENDESK_AUTO_EMAIL_KINDS.has(eventKind as NotifyPartnerJobChangeKind) ? "—" : "No auto-email";
  }
  return "Email failed";
}
