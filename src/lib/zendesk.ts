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
