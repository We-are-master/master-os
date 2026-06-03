/**
 * Minimal Zendesk Support API client — used for syncing OS state back into
 * tickets that originated in Zendesk Desk (linked via external_source='zendesk',
 * external_ref=<ticket_id>).
 *
 * Auth: Basic with `{email}/token:{api_token}` (Zendesk's API token scheme).
 * Docs: https://developer.zendesk.com/api-reference/ticketing/introduction/
 */

import { baseStatusForCustomStatusId } from "@/lib/zendesk-statuses";

const SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN?.trim();
const EMAIL     = process.env.ZENDESK_EMAIL?.trim();
const API_TOKEN = process.env.ZENDESK_API_TOKEN?.trim();

function authHeader(): string {
  return "Basic " + Buffer.from(`${EMAIL}/token:${API_TOKEN}`).toString("base64");
}

function baseUrl(): string {
  return `https://${SUBDOMAIN}.zendesk.com/api/v2`;
}

export function isZendeskConfigured(): boolean {
  return Boolean(SUBDOMAIN && EMAIL && API_TOKEN);
}

/**
 * Returns the linked Zendesk ticket id from any entity that uses the
 * external_source / external_ref convention (quotes, jobs, requests, …).
 * Returns null when the entity isn't Zendesk-linked.
 */
export function getZendeskTicketId(entity: {
  external_source?: string | null | undefined;
  external_ref?:    string | null | undefined;
} | null | undefined): string | null {
  if (!entity) return null;
  if (entity.external_source !== "zendesk") return null;
  const ref = entity.external_ref?.toString().trim();
  return ref ? ref : null;
}

export interface CreateTicketArgs {
  subject:        string;
  /** Plain text comment body. Either commentBody or htmlBody is required. */
  commentBody?:   string;
  /** HTML comment body — rendered in the requester email. */
  htmlBody?:      string;
  /** Comment visibility — defaults to true (customer can see). */
  publicComment?: boolean;
  /** Required by Zendesk — `name` is optional but `email` must be present. */
  requesterEmail: string;
  requesterName?: string | null;
  /** Optional custom status id (e.g. ZD_STATUS_SCHEDULED). When set, the
   *  base status is inferred from baseStatusForCustomStatusId. */
  customStatusId?: number;
  /** Optional tags to attach. */
  tags?:          string[];
  /** Optional external link back to the OS job/quote for support agents. */
  externalId?:    string;
}

export interface CreateTicketResult {
  ok:      boolean;
  /** Numeric ticket id when ok=true. */
  id?:     number;
  /** HTTP status from Zendesk (when reached). */
  status?: number;
  /** Error detail when ok=false. */
  error?:  string;
}

/**
 * Create a new Zendesk ticket. Used when the OS needs a parent ticket to
 * thread side conversations under but no ticket is linked yet (e.g. job
 * created directly without a Zendesk-originated quote).
 *
 * Returns ok=false (no throw) on any failure so the caller can decide
 * whether to fall back to a direct email or surface the error.
 */
export async function createTicket(args: CreateTicketArgs): Promise<CreateTicketResult> {
  if (!isZendeskConfigured()) {
    return { ok: false, error: "Zendesk not configured (set ZENDESK_SUBDOMAIN/EMAIL/API_TOKEN)" };
  }
  if (!args.requesterEmail?.trim()) {
    return { ok: false, error: "requesterEmail is required" };
  }
  if (!args.commentBody && !args.htmlBody) {
    return { ok: false, error: "commentBody or htmlBody is required" };
  }

  const comment: Record<string, unknown> = {
    public: args.publicComment ?? true,
  };
  if (args.htmlBody) comment.html_body = args.htmlBody;
  else comment.body = args.commentBody ?? "";

  const ticket: Record<string, unknown> = {
    subject: args.subject,
    comment,
    requester: args.requesterName
      ? { name: args.requesterName.trim(), email: args.requesterEmail.trim() }
      : { email: args.requesterEmail.trim() },
  };
  if (args.tags && args.tags.length > 0) ticket.tags = args.tags;
  if (args.externalId) ticket.external_id = args.externalId;
  if (args.customStatusId != null) {
    ticket.custom_status_id = args.customStatusId;
    const baseStatus = baseStatusForCustomStatusId(args.customStatusId);
    if (baseStatus) ticket.status = baseStatus;
  }

  const url = `${baseUrl()}/tickets.json`;
  const bodyPayload = JSON.stringify({ ticket });
  console.log(`[zendesk.createTicket] POST ${url} body=${bodyPayload.length > 500 ? bodyPayload.slice(0, 500) + "…" : bodyPayload}`);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": authHeader(),
        "Content-Type":  "application/json",
        Accept:          "application/json",
      },
      body: bodyPayload,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[zendesk.createTicket] failed (${res.status}):`, text.slice(0, 500));
      return { ok: false, status: res.status, error: text.slice(0, 500) };
    }
    const json = (await res.json().catch(() => ({}))) as { ticket?: { id?: number } };
    const id = json.ticket?.id;
    if (!id) {
      return { ok: false, status: res.status, error: "Zendesk response missing ticket.id" };
    }
    return { ok: true, id, status: res.status };
  } catch (err) {
    console.error("[zendesk.createTicket] network error:", err);
    return { ok: false, error: err instanceof Error ? err.message : "unknown error" };
  }
}

/**
 * Upload one or more attachments and post a public comment. Used by
 * customer-facing routes (quote sent, job final review, …) when the
 * entity is Zendesk-linked — replaces a Resend email send.
 *
 * Awaited — throws on failure so the caller can decide whether to fall
 * back to Resend or surface the error.
 */
export async function sendCustomerCommentWithAttachments(args: {
  ticketId:        string | number;
  htmlBody:        string;
  attachments?:    Array<{ filename: string; content: Buffer; contentType?: string }>;
  customStatusId?: number;
}): Promise<void> {
  if (!isZendeskConfigured()) throw new Error("Zendesk not configured");

  const uploadTokens: string[] = [];
  for (const att of args.attachments ?? []) {
    const token = await uploadAttachment(
      att.content,
      att.filename,
      att.contentType ?? "application/octet-stream",
    );
    uploadTokens.push(token);
  }

  await updateTicket({
    ticketId:       args.ticketId,
    customStatusId: args.customStatusId,
    htmlBody:       args.htmlBody,
    uploadTokens,
    publicComment:  true,
  });
}

/**
 * Upload a file to Zendesk and return the upload token.
 * The token is then attached to a ticket comment via `comment.uploads = [token]`.
 */
export async function uploadAttachment(
  file: Buffer,
  filename: string,
  contentType = "application/octet-stream",
): Promise<string> {
  if (!isZendeskConfigured()) throw new Error("Zendesk not configured");

  const url = `${baseUrl()}/uploads.json?filename=${encodeURIComponent(filename)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": authHeader(),
      "Content-Type":  contentType,
    },
    body: new Uint8Array(file),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zendesk upload failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { upload?: { token?: string } };
  const token = json.upload?.token;
  if (!token) throw new Error("Zendesk upload returned no token");
  return token;
}

interface UpdateTicketArgs {
  ticketId:        string | number;
  customStatusId?: number;
  /** Plain text body. Ignored when htmlBody is provided. */
  commentBody?:    string;
  /** HTML body — rendered in the customer email. Use simple email-safe HTML. */
  htmlBody?:       string;
  uploadTokens?:   string[];
  /** Whether the comment is visible to the requester. Default true. */
  publicComment?:  boolean;
}

/**
 * Update a Zendesk ticket — set custom status and/or post a public comment
 * with optional attachments.
 *
 * When a `customStatusId` is supplied, also sets the matching base `status`
 * (open / pending / solved). Zendesk returns 422 "Custom status is invalid"
 * if the new custom_status_id belongs to a different category than the
 * ticket's current base status, so we always send both together when we
 * know the mapping (lifecycle ids are in lib/zendesk-statuses.ts).
 */
export async function updateTicket(args: UpdateTicketArgs): Promise<void> {
  if (!isZendeskConfigured()) throw new Error("Zendesk not configured");

  const ticket: Record<string, unknown> = {};
  if (args.customStatusId != null) {
    ticket.custom_status_id = args.customStatusId;
    const baseStatus = baseStatusForCustomStatusId(args.customStatusId);
    if (baseStatus) ticket.status = baseStatus;
  }

  const hasContent = args.commentBody || args.htmlBody || (args.uploadTokens && args.uploadTokens.length > 0);
  if (hasContent) {
    const comment: Record<string, unknown> = {
      public:  args.publicComment ?? true,
      uploads: args.uploadTokens ?? [],
    };
    if (args.htmlBody) {
      comment.html_body = args.htmlBody;
    } else {
      comment.body = args.commentBody ?? "";
    }
    ticket.comment = comment;
  }

  const url = `${baseUrl()}/tickets/${encodeURIComponent(String(args.ticketId))}.json`;
  const tryPut = async (payload: Record<string, unknown>) => {
    const body = JSON.stringify({ ticket: payload });
    console.log(`[zendesk.updateTicket] PUT ${url} body=${body.length > 500 ? body.slice(0, 500) + "…" : body}`);
    return fetch(url, {
      method: "PUT",
      headers: {
        "Authorization": authHeader(),
        "Content-Type":  "application/json",
      },
      body,
    });
  };

  let res = await tryPut(ticket);

  // Defensive fallback: when Zendesk rejects the custom_status_id (typically
  // because the id isn't enabled on the ticket's form), retry with just the
  // base `status` — that's always valid and the ticket still ends up in the
  // right category (open/pending/solved). The custom label is just lost.
  if (
    !res.ok &&
    res.status === 422 &&
    ticket.custom_status_id != null &&
    typeof ticket.status === "string"
  ) {
    const errText = await res.clone().text().catch(() => "");
    if (errText.includes("custom_status_id") || errText.toLowerCase().includes("custom status is invalid")) {
      console.warn(
        `[zendesk.updateTicket] 422 on custom_status_id=${ticket.custom_status_id} (ticket ${args.ticketId}) — retrying with base status="${ticket.status}" only. Likely the custom status isn't enabled on the ticket's form in Zendesk admin.`,
      );
      const { custom_status_id: _drop, ...rest } = ticket;
      void _drop;
      res = await tryPut(rest);
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zendesk ticket update failed (${res.status}): ${text}`);
  }
}

/**
 * Zendesk custom field id that mirrors the OS job reference (e.g. "JOB-1234")
 * back into the linked ticket, so support agents can see / search the job
 * number without opening the OS. Overridable via env for other environments.
 */
export const ZENDESK_JOB_ID_FIELD_ID = Number(
  process.env.ZENDESK_JOB_ID_FIELD_ID?.trim() || "5824403479839",
);

export interface SetCustomFieldResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * Set a single custom field on a Zendesk ticket via a minimal PUT (no comment,
 * no status change). Best-effort: returns ok=false instead of throwing so
 * callers can fire-and-forget without breaking the OS flow.
 *
 * Zendesk merges `custom_fields` by id, so sending just this one field leaves
 * every other field on the ticket untouched.
 */
export async function setTicketCustomField(args: {
  ticketId: string | number;
  fieldId:  number;
  value:    string | number | boolean | null;
}): Promise<SetCustomFieldResult> {
  if (!isZendeskConfigured()) {
    return { ok: false, error: "Zendesk not configured" };
  }
  if (!args.ticketId || !Number.isFinite(args.fieldId)) {
    return { ok: false, error: "ticketId and a numeric fieldId are required" };
  }

  const url = `${baseUrl()}/tickets/${encodeURIComponent(String(args.ticketId))}.json`;
  const body = JSON.stringify({
    ticket: { custom_fields: [{ id: args.fieldId, value: args.value }] },
  });

  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization:  authHeader(),
        "Content-Type": "application/json",
        Accept:         "application/json",
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[zendesk.setTicketCustomField] field=${args.fieldId} ticket=${args.ticketId} failed (${res.status}):`, text.slice(0, 300));
      return { ok: false, status: res.status, error: text.slice(0, 300) };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    console.error("[zendesk.setTicketCustomField] network error:", err);
    return { ok: false, error: err instanceof Error ? err.message : "unknown error" };
  }
}

/**
 * Convenience wrapper: write the OS job reference into the linked ticket's
 * job-id custom field. No-op (ok=false) when Zendesk isn't configured or the
 * inputs are missing — callers should treat it as best-effort.
 */
export async function setTicketJobReference(
  ticketId: string | number | null | undefined,
  jobReference: string | null | undefined,
): Promise<SetCustomFieldResult> {
  const ref = jobReference?.toString().trim();
  if (!ticketId || !ref) {
    return { ok: false, error: "ticketId and jobReference are required" };
  }
  return setTicketCustomField({ ticketId, fieldId: ZENDESK_JOB_ID_FIELD_ID, value: ref });
}

/**
 * Zendesk Side Conversations API helper.
 *
 * Side conversations let us reach out to a partner via email *from inside*
 * the Zendesk ticket, so the conversation thread stays linked to the
 * originating ticket and the support team can see all communication.
 *
 * Docs: https://developer.zendesk.com/api-reference/ticketing/side_conversation/side_conversation/
 */

export interface SideConversationParams {
  /** Zendesk ticket id (numeric, but accepted as string for safety). */
  ticketId: string | number;
  /** Recipient email — typically the partner's email. */
  toEmail: string;
  /** Optional recipient display name. */
  toName?: string | null;
  /**
   * Optional Zendesk user id of the recipient. When set, Zendesk threads the
   * side conv under that user's organisation view (mirrored from
   * partners.zendesk_user_id).
   */
  toUserId?: string | null;
  /** Subject line for the side conversation. */
  subject: string;
  /** HTML body (set `bodyText` to a plaintext fallback if you have one). */
  htmlBody: string;
  /** Plaintext fallback for clients that can't render HTML. */
  bodyText?: string;
}

export interface SideConversationResult {
  ok: boolean;
  /** Side conversation id when ok=true. */
  id?: string;
  /** Error detail when ok=false. */
  error?: string;
  /** HTTP status from Zendesk (when reached). */
  status?: number;
}

/**
 * Open a new side conversation on an existing Zendesk ticket and send the
 * first message in it. Returns ok=false (no throw) on any failure so the
 * caller can decide whether to surface the error or keep going.
 */
export async function createSideConversation(
  params: SideConversationParams,
): Promise<SideConversationResult> {
  if (!isZendeskConfigured()) {
    return { ok: false, error: "Zendesk not configured (set ZENDESK_SUBDOMAIN/EMAIL/API_TOKEN)" };
  }
  if (!params.ticketId || !params.toEmail) {
    return { ok: false, error: "ticketId and toEmail are required" };
  }

  const url = `${baseUrl()}/tickets/${params.ticketId}/side_conversations`;

  // When the recipient already exists in Zendesk as a user (e.g. a partner
  // we've mirrored via syncPartnerToZendesk), passing `user_id` threads the
  // side conv into their organisation view. Email is still required by
  // Zendesk as the channel hint.
  const recipient: Record<string, unknown> = { email: params.toEmail };
  if (params.toName) recipient.name = params.toName;
  if (params.toUserId) {
    const n = Number(params.toUserId);
    if (Number.isFinite(n)) recipient.user_id = n;
  }

  const body = {
    message: {
      subject: params.subject,
      body: params.bodyText ?? stripHtml(params.htmlBody),
      html_body: params.htmlBody,
      to: [recipient],
    },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: authHeader(),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[zendesk] side conversation failed (${res.status}):`, text.slice(0, 500));
      return { ok: false, status: res.status, error: text.slice(0, 500) };
    }
    const json = await res.json().catch(() => ({}));
    const id = json?.side_conversation?.id;
    return { ok: true, id, status: res.status };
  } catch (err) {
    console.error("[zendesk] side conversation network error:", err);
    return { ok: false, error: err instanceof Error ? err.message : "unknown error" };
  }
}

/**
 * Reply on an existing side conversation. Used for follow-up emails
 * (status changed, cancelled, on hold) so the partner sees the whole
 * thread in their inbox instead of getting a new email per event.
 */
export async function replyToSideConversation(params: {
  ticketId: string | number;
  sideConversationId: string;
  htmlBody: string;
  bodyText?: string;
  /** Recipient email. Zendesk requires `to` on email side-conversation replies
   *  ("Invalid parameter: to is required"), so pass the partner's email. */
  toEmail?: string;
  toName?: string;
  toUserId?: string | number | null;
}): Promise<SideConversationResult> {
  if (!isZendeskConfigured()) {
    return { ok: false, error: "Zendesk not configured" };
  }
  if (!params.ticketId || !params.sideConversationId) {
    return { ok: false, error: "ticketId and sideConversationId are required" };
  }

  const url = `${baseUrl()}/tickets/${params.ticketId}/side_conversations/${params.sideConversationId}/reply`;
  const message: Record<string, unknown> = {
    body: params.bodyText ?? stripHtml(params.htmlBody),
    html_body: params.htmlBody,
  };
  if (params.toEmail) {
    const recipient: Record<string, unknown> = { email: params.toEmail };
    if (params.toName) recipient.name = params.toName;
    if (params.toUserId != null) {
      const n = Number(params.toUserId);
      if (Number.isFinite(n)) recipient.user_id = n;
    }
    message.to = [recipient];
  }
  const body = { message };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: authHeader(),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[zendesk] side conversation reply failed (${res.status}):`, text.slice(0, 500));
      return { ok: false, status: res.status, error: text.slice(0, 500) };
    }
    const json = await res.json().catch(() => ({}));
    return { ok: true, id: json?.message?.id, status: res.status };
  } catch (err) {
    console.error("[zendesk] reply network error:", err);
    return { ok: false, error: err instanceof Error ? err.message : "unknown error" };
  }
}

/**
 * Close a side conversation. Used after a job is claimed in auto-assign mode
 * so the partners who didn't win get their side conv thread closed in
 * Zendesk (the office still sees the history, but it falls out of the
 * "open" list).
 *
 * Zendesk supports `state: "open" | "closed"` on PUT
 * /api/v2/tickets/:id/side_conversations/:scId.json with the body shape
 * `{ "state": "closed" }` (no wrapper).
 */
export async function closeSideConversation(params: {
  ticketId: string | number;
  sideConversationId: string;
}): Promise<SideConversationResult> {
  if (!isZendeskConfigured()) {
    return { ok: false, error: "Zendesk not configured" };
  }
  if (!params.ticketId || !params.sideConversationId) {
    return { ok: false, error: "ticketId and sideConversationId are required" };
  }

  const url = `${baseUrl()}/tickets/${params.ticketId}/side_conversations/${params.sideConversationId}.json`;
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: authHeader(),
      },
      body: JSON.stringify({ state: "closed" }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[zendesk] side conversation close failed (${res.status}):`, text.slice(0, 500));
      return { ok: false, status: res.status, error: text.slice(0, 500) };
    }
    return { ok: true, id: params.sideConversationId, status: res.status };
  } catch (err) {
    console.error("[zendesk] side conversation close network error:", err);
    return { ok: false, error: err instanceof Error ? err.message : "unknown error" };
  }
}

// ─── Organisations + Users ──────────────────────────────────────────────
//
// Used to mirror OS partners into Zendesk so side conversations on jobs
// can target the partner's Zendesk user_id (which automatically threads
// them under the partner's organisation in the Zendesk UI).
//
// We use create_or_update endpoints, keyed on `external_id` — so re-syncing
// the same partner is idempotent and won't create duplicates.

export interface ZendeskOrgResult {
  ok:     boolean;
  id?:    string;
  status?: number;
  error?: string;
}

/** Emoji prefix convention used in Zendesk org names so the office can scan
 *  the list visually: 🔧 = partner (trade), 🏢 = account (client). */
const ZD_ORG_EMOJI = { partner: "🔧", account: "🏢" } as const;
export type ZendeskOrgKind = keyof typeof ZD_ORG_EMOJI;

/** Strip any leading emoji prefix from a name before re-applying the canonical one. */
function stripLeadingEmoji(name: string): string {
  return name.replace(/^[\p{Extended_Pictographic}\u{FE0F}\s]+/u, "").trim();
}

/**
 * Create or update a Zendesk Organisation for a partner or account.
 *
 * Naming: the name is normalised to `${emoji} ${cleanName}` based on `kind`.
 * Dedup: keyed on `external_id = fixfy:<kind>:<uuid>`.
 * Custom fields populated:
 *   - `org_id`  → the OS UUID (existing field, used by the office to copy back)
 *   - `os_type` → "partner" | "account" (drives filters/reports in Zendesk)
 */
export async function createOrUpdateZendeskOrganization(params: {
  kind:           ZendeskOrgKind;
  name:           string;
  /** OS UUID — used for both `external_id` and the `org_id` custom field. */
  entityId:       string;
  details?:       string;
  domainNames?:   string[];
}): Promise<ZendeskOrgResult> {
  if (!isZendeskConfigured()) {
    return { ok: false, error: "Zendesk not configured" };
  }
  if (!params.name?.trim()) {
    return { ok: false, error: "name is required" };
  }

  const emoji = ZD_ORG_EMOJI[params.kind];
  const cleanName = stripLeadingEmoji(params.name);
  const displayName = `${emoji} ${cleanName}`;

  const url = `${baseUrl()}/organizations/create_or_update.json`;
  const body = {
    organization: {
      name:               displayName,
      external_id:        `fixfy:${params.kind}:${params.entityId}`,
      details:            params.details,
      domain_names:       params.domainNames,
      organization_fields: {
        org_id:  params.entityId,
        os_type: params.kind,
      },
    },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: authHeader(),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[zendesk] org create_or_update failed (${res.status}):`, text.slice(0, 500));
      return { ok: false, status: res.status, error: text.slice(0, 500) };
    }
    const json = await res.json().catch(() => ({}));
    const id = json?.organization?.id;
    return { ok: true, id: id !== undefined ? String(id) : undefined, status: res.status };
  } catch (err) {
    console.error("[zendesk] org create_or_update network error:", err);
    return { ok: false, error: err instanceof Error ? err.message : "unknown error" };
  }
}

/**
 * Create or update a Zendesk User (end-user role) for the partner or account
 * contact. Keyed by email — re-running with the same email returns the
 * existing user.
 *
 * `external_id` is `fixfy:<kind>-contact:<uuid>` so we can find the user back
 * from the OS entity id without scanning by email.
 */
export async function createOrUpdateZendeskUser(params: {
  kind:            ZendeskOrgKind;
  name:            string;
  email:           string;
  /** OS UUID of the parent entity (partner.id or account.id). */
  entityId:        string;
  /** Zendesk org id (string) — when set, the user is placed under this org. */
  organizationId?: string;
  phone?:          string;
}): Promise<ZendeskOrgResult> {
  if (!isZendeskConfigured()) {
    return { ok: false, error: "Zendesk not configured" };
  }
  if (!params.email?.trim() || !params.name?.trim()) {
    return { ok: false, error: "name and email are required" };
  }

  const url = `${baseUrl()}/users/create_or_update.json`;
  const userBody: Record<string, unknown> = {
    name:        params.name.trim(),
    email:       params.email.trim().toLowerCase(),
    external_id: `fixfy:${params.kind}-contact:${params.entityId}`,
    role:        "end-user",
    verified:    true,
  };
  if (params.organizationId) {
    const n = Number(params.organizationId);
    if (Number.isFinite(n)) userBody.organization_id = n;
  }
  if (params.phone?.trim()) userBody.phone = params.phone.trim();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: authHeader(),
      },
      body: JSON.stringify({ user: userBody }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[zendesk] user create_or_update failed (${res.status}):`, text.slice(0, 500));
      return { ok: false, status: res.status, error: text.slice(0, 500) };
    }
    const json = await res.json().catch(() => ({}));
    const id = json?.user?.id;
    return { ok: true, id: id !== undefined ? String(id) : undefined, status: res.status };
  } catch (err) {
    console.error("[zendesk] user create_or_update network error:", err);
    return { ok: false, error: err instanceof Error ? err.message : "unknown error" };
  }
}

function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
