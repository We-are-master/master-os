/**
 * Zendesk ↔ OS catalog mapping — field ids, service/band tag helpers.
 *
 * Zendesk stores prefixed tags (`os_<uuid>`, `band_<uuid>`) for global uniqueness.
 * OS stores and processes bare UUIDs everywhere.
 */

import { isValidUUID } from "@/lib/auth-api";

/** Operational Zendesk ticket field ids (master.zendesk.com). */
export const ZENDESK_FIELD_IDS = {
  TYPE_OF_WORK: 5687087915551,
  SCOPE: 5687121072927,
  ADDRESS: 5693026186527,
  QUOTE_MODE: 5693026498847,
  JOB_DATE: 5693027123999,
  CLIENT_NAME: 5693105918623,
  REPLY_STATUS: 5698641403423,
  CLIENT_PRICE: 5703050059039,
  ARRIVAL_TIME: 5737641586335,
  REPORT_LINK: 5754991026207,
  CONTACT_TYPE: 5799859726879,
  RATE_TYPE: 5807260876063,
  AUTO_ASSIGN: 5811578972703,
  CLIENT_PHONE: 5811689527071,
  CLIENT_EMAIL: 5811705681183,
  JOB_ID: 5824403479839,
  CANCELLATION_NOTES: 5834293455647,
  ON_HOLD_REASON: 5834320428319,
  SOLUTION: 5834320432031,
  COMPLAINT_DESCRIPTION: 5834327783327,
  CANCELLATION_REASON: 5834334215583,
  LOST_REVENUE: 5849320808607,
  EPC_BAND: 5853839193247,
  FRA_BAND: 5853837434527,
  EICR_BAND: 5853864806559,
  PAT_BAND: 5853839199903,
  GSC_BAND: 5853819554335,
  FAC_BAND: 5854678454047,
} as const;

/** service_catalog.id → Zendesk band dropdown field id. */
export const BAND_FIELD_BY_SERVICE_ID: Record<string, number> = {
  "06271726-30ca-4f5f-9579-384de83d8ecf": ZENDESK_FIELD_IDS.EPC_BAND,
  "a1f8b034-28d4-4775-8c47-272df6701aa2": ZENDESK_FIELD_IDS.FRA_BAND,
  "e0cbd852-c10c-4aac-b52c-dfd274b65848": ZENDESK_FIELD_IDS.EICR_BAND,
  "7796473e-c22b-4452-a22f-de1b8a87045a": ZENDESK_FIELD_IDS.PAT_BAND,
  "d978384e-d1be-45ef-914a-9172f8d9fe62": ZENDESK_FIELD_IDS.GSC_BAND,
  "ea6d7f17-1a9b-44ea-87d8-0e9ebf857431": ZENDESK_FIELD_IDS.FAC_BAND,
};

export function toZendeskServiceTag(osServiceId: string): string {
  const id = osServiceId.trim();
  if (id.toLowerCase().startsWith("os_")) return id;
  return `os_${id}`;
}

export function fromZendeskServiceTag(tag: string): string | null {
  const t = tag.trim();
  if (!t) return null;
  const stripped = t.replace(/^os_/i, "");
  return isValidUUID(stripped) ? stripped : null;
}

/** Resolve OS catalog id from Zendesk option value (prefixed or legacy bare UUID). */
export function catalogIdFromZendeskOptionValue(value: string): string | null {
  const fromTag = fromZendeskServiceTag(value);
  if (fromTag) return fromTag;
  const bare = value.trim();
  return isValidUUID(bare) ? bare : null;
}

export function toZendeskBandTag(osBandId: string): string {
  const id = osBandId.trim();
  if (id.toLowerCase().startsWith("band_")) return id;
  return `band_${id}`;
}

export function fromZendeskBandTag(tag: string): string | null {
  const t = tag.trim();
  if (!t) return null;
  const stripped = t.replace(/^band_/i, "");
  return isValidUUID(stripped) ? stripped : null;
}

export function zendeskBandFieldIdForCatalog(catalogServiceId: string): number | null {
  const id = BAND_FIELD_BY_SERVICE_ID[catalogServiceId.trim()];
  return typeof id === "number" && id > 0 ? id : null;
}

export function getBandFieldForService(osServiceId: string): number | null {
  return zendeskBandFieldIdForCatalog(osServiceId);
}
