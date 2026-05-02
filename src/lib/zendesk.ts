/**
 * Zendesk Side Conversations API helper.
 *
 * Side conversations let us reach out to a partner via email *from inside*
 * the Zendesk ticket, so the conversation thread stays linked to the
 * originating ticket and the support team can see all communication.
 *
 * Docs: https://developer.zendesk.com/api-reference/ticketing/side_conversation/side_conversation/
 *
 * Auth: HTTP Basic with `{email}/token:{api_token}` (Base64 encoded).
 */

const ZENDESK_SUBDOMAIN  = process.env.ZENDESK_SUBDOMAIN?.trim();
const ZENDESK_EMAIL      = process.env.ZENDESK_EMAIL?.trim();
const ZENDESK_API_TOKEN  = process.env.ZENDESK_API_TOKEN?.trim();

function isConfigured(): boolean {
  return Boolean(ZENDESK_SUBDOMAIN && ZENDESK_EMAIL && ZENDESK_API_TOKEN);
}

function authHeader(): string {
  if (!isConfigured()) throw new Error("Zendesk not configured");
  const creds = `${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`;
  return `Basic ${Buffer.from(creds).toString("base64")}`;
}

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
  if (!isConfigured()) {
    return { ok: false, error: "Zendesk not configured (set ZENDESK_SUBDOMAIN/EMAIL/API_TOKEN)" };
  }
  if (!params.ticketId || !params.toEmail) {
    return { ok: false, error: "ticketId and toEmail are required" };
  }

  const url = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets/${params.ticketId}/side_conversations`;

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
  if (!isConfigured()) {
    return { ok: false, error: "Zendesk not configured" };
  }
  if (!params.ticketId || !params.sideConversationId) {
    return { ok: false, error: "ticketId and sideConversationId are required" };
  }

  const url = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets/${params.ticketId}/side_conversations/${params.sideConversationId}/reply`;
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
