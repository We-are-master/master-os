/**
 * Zendesk ticket-form ids + prefillable custom-field ids for OS-created tickets.
 *
 * Client-safe (plain numbers, no server-only imports) so the Create Job / Create
 * Quote modals can build the `custom_fields` payload. Defaults are the real ids
 * on master.zendesk.com; override per-environment via NEXT_PUBLIC_* envs.
 */

const envNum = (v: string | undefined, dflt: string): number => Number(v?.trim() || dflt) || 0;

/** Ticket form ids per OS entity. 0 = don't set a form. */
export const ZENDESK_JOB_TICKET_FORM_ID   = envNum(process.env.NEXT_PUBLIC_ZENDESK_JOB_TICKET_FORM_ID,   "5687141596959");
export const ZENDESK_QUOTE_TICKET_FORM_ID = envNum(process.env.NEXT_PUBLIC_ZENDESK_QUOTE_TICKET_FORM_ID, "5755031675935");

/** Prefillable custom fields on the Job (and partly Quote) form. 0 = skip. */
export const ZENDESK_FIELD_JOB_DATE     = envNum(process.env.NEXT_PUBLIC_ZENDESK_FIELD_JOB_DATE,     "5693027123999");
export const ZENDESK_FIELD_CLIENT_NAME  = envNum(process.env.NEXT_PUBLIC_ZENDESK_FIELD_CLIENT_NAME,  "5693105918623");
export const ZENDESK_FIELD_CLIENT_EMAIL = envNum(process.env.NEXT_PUBLIC_ZENDESK_FIELD_CLIENT_EMAIL, "5811705681183");
export const ZENDESK_FIELD_CLIENT_PHONE = envNum(process.env.NEXT_PUBLIC_ZENDESK_FIELD_CLIENT_PHONE, "5811689527071");
export const ZENDESK_FIELD_ADDRESS      = envNum(process.env.NEXT_PUBLIC_ZENDESK_FIELD_ADDRESS,      "5693026186527");
export const ZENDESK_FIELD_CLIENT_PRICE = envNum(process.env.NEXT_PUBLIC_ZENDESK_FIELD_CLIENT_PRICE, "5703050059039");
export const ZENDESK_FIELD_SCOPE        = envNum(process.env.NEXT_PUBLIC_ZENDESK_FIELD_SCOPE,        "5687121072927");
export const ZENDESK_FIELD_REPORT_LINK  = envNum(process.env.NEXT_PUBLIC_ZENDESK_FIELD_REPORT_LINK,  "5754991026207");

/** Build a Zendesk `custom_fields` array, dropping empty values. */
export function buildZendeskCustomFields(
  pairs: Array<[number, unknown]>,
): Array<{ id: number; value: unknown }> {
  return pairs
    .filter(([id, value]) => id > 0 && value != null && value !== "")
    .map(([id, value]) => ({ id, value }));
}
