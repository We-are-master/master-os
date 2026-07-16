import type { RpaConfig } from "../config.js";
import type { CreateJobPayload, CreateLeadPayload, MasterOsCreateResponse } from "./types.js";

export class MasterOsApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Master OS API error ${status}: ${body}`);
  }
}

async function post(url: string, apiKey: string, payload: unknown): Promise<MasterOsCreateResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new MasterOsApiError(res.status, text);
  return JSON.parse(text) as MasterOsCreateResponse;
}

export function createMasterOsClient(cfg: RpaConfig) {
  return {
    async createJob(payload: CreateJobPayload): Promise<MasterOsCreateResponse> {
      return post(`${cfg.masterOs.baseUrl}/api/jobs`, cfg.env.masterOsJobApiKey, payload);
    },
    async createLead(payload: CreateLeadPayload): Promise<MasterOsCreateResponse> {
      return post(`${cfg.masterOs.baseUrl}/api/leads`, cfg.env.masterOsLeadApiKey, payload);
    },
    /**
     * Sets external_source='zendesk' + external_ref=ticketId on an existing
     * job — this is what makes the clickable "#12345" Zendesk badge appear
     * on the job card/detail view in the Master OS UI. Deliberately NOT the
     * same as POST /api/jobs's `ticket_id` param (which triggers a full
     * Zendesk-macro reconciliation flow — customer-facing replies, ticket
     * requester reassignment, side conversations — designed for tickets
     * that originated the job, not the other way around). This just sets
     * the link, plus a best-effort mirror of the job reference into the
     * ticket's own custom field — no customer-facing side effects.
     */
    async linkZendeskTicket(jobId: string, ticketId: string | number): Promise<void> {
      const res = await fetch(`${cfg.masterOs.baseUrl}/api/jobs/${jobId}/zendesk-link`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-API-Key": cfg.env.masterOsJobApiKey },
        body: JSON.stringify({ ticketId: String(ticketId) }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new MasterOsApiError(res.status, text);
      }
    },
  };
}

export type MasterOsClient = ReturnType<typeof createMasterOsClient>;
