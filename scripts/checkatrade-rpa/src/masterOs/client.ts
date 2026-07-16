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
  };
}

export type MasterOsClient = ReturnType<typeof createMasterOsClient>;
