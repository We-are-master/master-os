import type { RpaConfig } from "../config.js";

export type ZendeskTicketInput = {
  subject: string;
  body: string;
};

export type ZendeskTicket = {
  id: number;
  url: string;
};

function authHeader(cfg: RpaConfig): string {
  const { email, apiToken } = cfg.zendesk;
  return `Basic ${Buffer.from(`${email}/token:${apiToken}`).toString("base64")}`;
}

/**
 * Creates a Zendesk ticket and returns its id/url so the caller can link it
 * to the Master OS job (via masterOs.linkZendeskTicket, once the job
 * exists) and add a follow-up comment on the SAME ticket with the Master OS
 * reference (see addZendeskComment) — full bidirectional link, job <-> ticket.
 * Best-effort: callers should not let a Zendesk failure block the actual
 * job/lead creation in Master OS — this is a tracking side effect, not a
 * source of truth. Returns null instead of throwing when disabled/failed.
 */
export async function createZendeskTicket(cfg: RpaConfig, input: ZendeskTicketInput): Promise<ZendeskTicket | null> {
  if (!cfg.zendesk.enabled) return null;
  const { subdomain, priority } = cfg.zendesk;

  const res = await fetch(`https://${subdomain}.zendesk.com/api/v2/tickets.json`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: authHeader(cfg) },
    body: JSON.stringify({
      ticket: { subject: input.subject, comment: { body: input.body }, priority },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zendesk ticket creation failed (${res.status}): ${text.slice(0, 500)}`);
  }
  const data = (await res.json()) as { ticket: { id: number; url: string } };
  return { id: data.ticket.id, url: `https://${subdomain}.zendesk.com/agent/tickets/${data.ticket.id}` };
}

/** Adds a follow-up (public) comment to an existing ticket — used to post the Master OS reference once the job exists. */
export async function addZendeskComment(cfg: RpaConfig, ticketId: number, body: string): Promise<void> {
  if (!cfg.zendesk.enabled) return;
  const { subdomain } = cfg.zendesk;

  const res = await fetch(`https://${subdomain}.zendesk.com/api/v2/tickets/${ticketId}.json`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: authHeader(cfg) },
    body: JSON.stringify({ ticket: { comment: { body, public: true } } }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zendesk comment failed (${res.status}): ${text.slice(0, 500)}`);
  }
}
