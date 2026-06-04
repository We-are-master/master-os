/**
 * Zendesk dropdown tag prefixes — unique across all custom fields on the account.
 * OS stores bare ids; Zendesk option values use `{fieldType}_{osId}`.
 */

export const ZENDESK_REASON_TAG_PREFIX = {
  cancel: "cancel_",
  hold: "hold_",
} as const;

export type ZendeskReasonFieldType = keyof typeof ZENDESK_REASON_TAG_PREFIX;

/** OS id → Zendesk tagger value (e.g. `client_requested` + cancel → `cancel_client_requested`). */
export function toZendeskTag(osId: string, fieldType: ZendeskReasonFieldType): string {
  const id = osId.trim();
  if (!id) return "";
  const prefix = ZENDESK_REASON_TAG_PREFIX[fieldType];
  if (id.startsWith(prefix)) return id;
  return `${prefix}${id}`;
}

/** Zendesk tag → bare OS id (strips one `{fieldType}_` prefix; accepts legacy bare ids). */
export function fromZendeskTag(zdTag: string, fieldType: ZendeskReasonFieldType): string {
  const v = zdTag.trim();
  if (!v) return "";
  const prefix = ZENDESK_REASON_TAG_PREFIX[fieldType];
  if (v.startsWith(prefix)) return v.slice(prefix.length);
  return v;
}
