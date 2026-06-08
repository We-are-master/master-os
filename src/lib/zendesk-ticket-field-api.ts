/**
 * Shared Zendesk ticket field API helpers (GET/PUT custom_field_options).
 */

export interface ZendeskFieldOption {
  id?: number;
  name: string;
  value: string;
  position?: number;
}

export type ZendeskTicketFieldApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

function zendeskSubdomain(): string {
  return process.env.ZENDESK_SUBDOMAIN?.trim() ?? "";
}

/** Supports both ZENDESK_EMAIL and ZENDESK_API_EMAIL env names. */
export function zendeskApiEmail(): string {
  return (
    process.env.ZENDESK_EMAIL?.trim()
    || process.env.ZENDESK_API_EMAIL?.trim()
    || ""
  );
}

function zendeskApiToken(): string {
  return process.env.ZENDESK_API_TOKEN?.trim() ?? "";
}

export function isZendeskApiConfigured(): boolean {
  return Boolean(zendeskSubdomain() && zendeskApiEmail() && zendeskApiToken());
}

export function zendeskAuthHeader(): string {
  const email = zendeskApiEmail();
  const token = zendeskApiToken();
  return "Basic " + Buffer.from(`${email}/token:${token}`).toString("base64");
}

function ticketFieldUrl(fieldId: number): string {
  return `https://${zendeskSubdomain()}.zendesk.com/api/v2/ticket_fields/${fieldId}.json`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Fetch with exponential backoff on transient Zendesk failures (429, 5xx).
 */
export async function zendeskFetchWithRetry(
  url: string,
  init: RequestInit,
  opts?: { retries?: number; baseDelayMs?: number },
): Promise<Response> {
  const retries = opts?.retries ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 300;
  let lastRes: Response | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { ...init, cache: "no-store" });
    lastRes = res;
    if (res.ok || !shouldRetryStatus(res.status) || attempt === retries) {
      return res;
    }
    const delay = baseDelayMs * 2 ** attempt;
    console.warn("[zendesk-ticket-field-api] retrying", {
      url,
      status: res.status,
      attempt: attempt + 1,
      delayMs: delay,
    });
    await sleep(delay);
  }

  return lastRes!;
}

export async function fetchZendeskTicketFieldOptions(
  fieldId: number,
): Promise<ZendeskTicketFieldApiResult<ZendeskFieldOption[]>> {
  if (!isZendeskApiConfigured()) {
    return { ok: false, error: "zendesk_api_not_configured" };
  }

  const res = await zendeskFetchWithRetry(ticketFieldUrl(fieldId), {
    method: "GET",
    headers: { Authorization: zendeskAuthHeader(), Accept: "application/json" },
  });

  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `zendesk GET ${res.status}: ${body.slice(0, 300)}`, status: res.status };
  }

  const data = (await res.json()) as { ticket_field?: { custom_field_options?: ZendeskFieldOption[] } };
  return { ok: true, data: data.ticket_field?.custom_field_options ?? [] };
}

export async function putZendeskTicketFieldOptions(
  fieldId: number,
  options: ZendeskFieldOption[],
): Promise<ZendeskTicketFieldApiResult<ZendeskFieldOption[]>> {
  if (!isZendeskApiConfigured()) {
    return { ok: false, error: "zendesk_api_not_configured" };
  }

  const res = await zendeskFetchWithRetry(ticketFieldUrl(fieldId), {
    method: "PUT",
    headers: {
      Authorization: zendeskAuthHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ ticket_field: { custom_field_options: options } }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `zendesk PUT ${res.status}: ${body.slice(0, 300)}`, status: res.status };
  }

  const data = (await res.json()) as { ticket_field?: { custom_field_options?: ZendeskFieldOption[] } };
  return { ok: true, data: data.ticket_field?.custom_field_options ?? [] };
}
