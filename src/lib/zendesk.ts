/**
 * Minimal Zendesk Support API client — used for syncing OS state back into
 * tickets that originated in Zendesk Desk (linked via external_source='zendesk',
 * external_ref=<ticket_id>).
 *
 * Auth: Basic with `{email}/token:{api_token}` (Zendesk's API token scheme).
 * Docs: https://developer.zendesk.com/api-reference/ticketing/introduction/
 */

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
 */
export async function updateTicket(args: UpdateTicketArgs): Promise<void> {
  if (!isZendeskConfigured()) throw new Error("Zendesk not configured");

  const ticket: Record<string, unknown> = {};
  if (args.customStatusId != null) ticket.custom_status_id = args.customStatusId;

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
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": authHeader(),
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({ ticket }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zendesk ticket update failed (${res.status}): ${text}`);
  }
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

  const body = {
    message: {
      subject: params.subject,
      body: params.bodyText ?? stripHtml(params.htmlBody),
      html_body: params.htmlBody,
      to: [
        params.toName
          ? { name: params.toName, email: params.toEmail }
          : { email: params.toEmail },
      ],
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
}): Promise<SideConversationResult> {
  if (!isZendeskConfigured()) {
    return { ok: false, error: "Zendesk not configured" };
  }
  if (!params.ticketId || !params.sideConversationId) {
    return { ok: false, error: "ticketId and sideConversationId are required" };
  }

  const url = `${baseUrl()}/tickets/${params.ticketId}/side_conversations/${params.sideConversationId}/reply`;
  const body = {
    message: {
      body: params.bodyText ?? stripHtml(params.htmlBody),
      html_body: params.htmlBody,
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

function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
