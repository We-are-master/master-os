/**
 * OS → Zendesk: mirror job and quote fields onto linked ticket forms.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { catalogServiceIdForTypeOfWorkLabel } from "@/lib/type-of-work";
import {
  getZendeskTicketId,
  isZendeskConfigured,
  setTicketCustomFields,
  zendeskQuoteRefFieldId,
  ZENDESK_ARRIVAL_WINDOW_FIELD_ID,
  ZENDESK_AUTO_ASSIGN_FIELD_ID,
  ZENDESK_CLIENT_EMAIL_FIELD_ID,
  ZENDESK_CLIENT_NAME_FIELD_ID,
  ZENDESK_CLIENT_PHONE_FIELD_ID,
  ZENDESK_JOB_ID_FIELD_ID,
  ZENDESK_JOB_TYPE_FIELD_ID,
  ZENDESK_PROPERTY_ADDRESS_FIELD_ID,
  ZENDESK_RATE_TYPE_FIELD_ID,
  ZENDESK_SCOPE_FIELD_ID,
  ZENDESK_TYPE_OF_WORK_FIELD_ID,
  ZENDESK_REPLY_STATUS_FIELD_ID,
  ZENDESK_REPLY_STATUS_SENT_VALUE,
  type TicketCustomFieldEntry,
} from "@/lib/zendesk";
import {
  matchArrivalSlot,
  nearestArrivalSlot,
  snapArrivalWindowMinutes,
  type ArrivalSlotId,
} from "@/lib/job-arrival-window";
import { utcIsoToUkWallClock } from "@/lib/utils/uk-time";

export interface ZendeskFormSyncResult {
  ok: boolean;
  ticketId?: string;
  syncedFields: string[];
  skipped?: string;
  error?: string;
}

/** @deprecated Use ZendeskFormSyncResult */
export type ZendeskJobFormSyncResult = ZendeskFormSyncResult;

function zendeskArrivalWindowTag(slotId: ArrivalSlotId): string {
  switch (slotId) {
    case "morning":
      return "arrival_morning";
    case "early_afternoon":
      return "arrival_early_afternoon";
    case "afternoon":
      return "arrival_late_afternoon";
    case "evening":
      return "arrival_evening";
    default:
      return `arrival_${slotId}`;
  }
}

function arrivalTagFromStartIso(startIso: string | null | undefined): string | null {
  if (!startIso) return null;
  const { hm: from } = utcIsoToUkWallClock(startIso);
  if (!from) return null;
  const slotId = matchArrivalSlot(from, 0) ?? nearestArrivalSlot(from, 0);
  return zendeskArrivalWindowTag(slotId);
}

function arrivalTagFromJob(job: {
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
}): string | null {
  if (!job.scheduled_start_at) return null;
  const { hm: from } = utcIsoToUkWallClock(job.scheduled_start_at);
  if (!from) return null;

  let windowMins = 0;
  if (job.scheduled_end_at) {
    const startMs = new Date(job.scheduled_start_at).getTime();
    const endMs = new Date(job.scheduled_end_at).getTime();
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      const snapped = snapArrivalWindowMinutes(startMs, endMs);
      windowMins = snapped ? Number(snapped) : 0;
    }
  }

  const slotId = matchArrivalSlot(from, windowMins) ?? nearestArrivalSlot(from, windowMins);
  return zendeskArrivalWindowTag(slotId);
}

function jobTypeTag(jobType: string | null | undefined): string | null {
  const t = (jobType ?? "fixed").toLowerCase();
  if (t === "hourly") return "job_type_hourly";
  if (t === "fixed") return "job_type_fixed";
  return null;
}

function pushText(
  fields: TicketCustomFieldEntry[],
  fieldId: number,
  value: string | null | undefined,
): void {
  const v = value?.trim();
  if (fieldId > 0 && v) fields.push({ fieldId, value: v });
}

type CommonFormInput = {
  reference?: string | null;
  referenceFieldId?: number;
  catalog_service_id?: string | null;
  job_type?: string | null;
  arrivalStartIso?: string | null;
  arrivalFromSchedule?: { scheduled_start_at?: string | null; scheduled_end_at?: string | null };
  autoAssign?: boolean;
  client_email?: string | null;
  client_name?: string | null;
  property_address?: string | null;
  client_phone?: string | null;
  scope?: string | null;
};

function buildCommonZendeskFormFieldEntries(input: CommonFormInput): TicketCustomFieldEntry[] {
  const fields: TicketCustomFieldEntry[] = [];

  const refFieldId = input.referenceFieldId ?? ZENDESK_JOB_ID_FIELD_ID;
  const ref = input.reference?.toString().trim();
  if (ref && refFieldId > 0) {
    fields.push({ fieldId: refFieldId, value: ref });
  }

  const catalogId = input.catalog_service_id?.trim();
  if (catalogId && ZENDESK_TYPE_OF_WORK_FIELD_ID > 0) {
    fields.push({ fieldId: ZENDESK_TYPE_OF_WORK_FIELD_ID, value: catalogId });
  }

  const rateTag = jobTypeTag(input.job_type);
  if (rateTag && ZENDESK_JOB_TYPE_FIELD_ID > 0) {
    fields.push({ fieldId: ZENDESK_JOB_TYPE_FIELD_ID, value: rateTag });
  }

  const ratePlain = (input.job_type ?? "fixed").toLowerCase();
  if ((ratePlain === "fixed" || ratePlain === "hourly") && ZENDESK_RATE_TYPE_FIELD_ID > 0) {
    fields.push({ fieldId: ZENDESK_RATE_TYPE_FIELD_ID, value: ratePlain });
  }

  const arrivalTag = input.arrivalFromSchedule
    ? arrivalTagFromJob(input.arrivalFromSchedule)
    : arrivalTagFromStartIso(input.arrivalStartIso);
  if (arrivalTag && ZENDESK_ARRIVAL_WINDOW_FIELD_ID > 0) {
    fields.push({ fieldId: ZENDESK_ARRIVAL_WINDOW_FIELD_ID, value: arrivalTag });
  }

  if (ZENDESK_AUTO_ASSIGN_FIELD_ID > 0 && input.autoAssign != null) {
    fields.push({ fieldId: ZENDESK_AUTO_ASSIGN_FIELD_ID, value: input.autoAssign });
  }

  pushText(fields, ZENDESK_CLIENT_EMAIL_FIELD_ID, input.client_email);
  pushText(fields, ZENDESK_CLIENT_NAME_FIELD_ID, input.client_name);
  pushText(fields, ZENDESK_PROPERTY_ADDRESS_FIELD_ID, input.property_address);
  pushText(fields, ZENDESK_CLIENT_PHONE_FIELD_ID, input.client_phone);
  pushText(fields, ZENDESK_SCOPE_FIELD_ID, input.scope);

  if (ZENDESK_REPLY_STATUS_FIELD_ID > 0) {
    fields.push({
      fieldId: ZENDESK_REPLY_STATUS_FIELD_ID,
      value: ZENDESK_REPLY_STATUS_SENT_VALUE,
    });
  }

  return fields;
}

function clientEmbedContact(clients: unknown): { email: string; phone: string } {
  const row = Array.isArray(clients) ? clients[0] : clients;
  const c = row as { email?: string | null; phone?: string | null } | null | undefined;
  return {
    email: c?.email?.trim() ?? "",
    phone: c?.phone?.trim() ?? "",
  };
}

export function buildJobZendeskFormFieldEntries(job: {
  reference?: string | null;
  catalog_service_id?: string | null;
  job_type?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  status?: string | null;
  auto_assign_invited_partner_ids?: string[] | null;
  client_name?: string | null;
  property_address?: string | null;
  scope?: string | null;
  clients?: { email?: string | null; phone?: string | null } | { email?: string | null; phone?: string | null }[] | null;
}): TicketCustomFieldEntry[] {
  const { email, phone } = clientEmbedContact(job.clients);
  const isAuto =
    job.status === "auto_assigning" ||
    (Array.isArray(job.auto_assign_invited_partner_ids) && job.auto_assign_invited_partner_ids.length > 0);

  return buildCommonZendeskFormFieldEntries({
    reference: job.reference,
    referenceFieldId: ZENDESK_JOB_ID_FIELD_ID,
    catalog_service_id: job.catalog_service_id,
    job_type: job.job_type,
    arrivalFromSchedule: {
      scheduled_start_at: job.scheduled_start_at,
      scheduled_end_at: job.scheduled_end_at,
    },
    autoAssign: isAuto,
    client_email: email,
    client_name: job.client_name,
    property_address: job.property_address,
    client_phone: phone,
    scope: job.scope,
  });
}

export function buildQuoteZendeskFormFieldEntries(quote: {
  reference?: string | null;
  catalog_service_id?: string | null;
  status?: string | null;
  quote_type?: string | null;
  start_date_option_1?: string | null;
  client_email?: string | null;
  client_name?: string | null;
  property_address?: string | null;
  scope?: string | null;
  clients?: { email?: string | null; phone?: string | null } | { email?: string | null; phone?: string | null }[] | null;
}): TicketCustomFieldEntry[] {
  const { email: embedEmail, phone } = clientEmbedContact(quote.clients);
  const email = quote.client_email?.trim() || embedEmail;
  const isBidding = quote.status === "bidding";

  return buildCommonZendeskFormFieldEntries({
    reference: quote.reference,
    referenceFieldId: zendeskQuoteRefFieldId(),
    catalog_service_id: quote.catalog_service_id,
    job_type: "fixed",
    arrivalStartIso: quote.start_date_option_1,
    autoAssign: isBidding,
    client_email: email,
    client_name: quote.client_name,
    property_address: quote.property_address,
    client_phone: phone,
    scope: quote.scope,
  });
}

const JOB_FIELD_KEYS: { id: number; key: string }[] = [
  { id: ZENDESK_JOB_ID_FIELD_ID, key: "job_reference" },
  { id: ZENDESK_TYPE_OF_WORK_FIELD_ID, key: "type_of_work" },
  { id: ZENDESK_JOB_TYPE_FIELD_ID, key: "job_type" },
  { id: ZENDESK_RATE_TYPE_FIELD_ID, key: "rate_type" },
  { id: ZENDESK_ARRIVAL_WINDOW_FIELD_ID, key: "arrival_window" },
  { id: ZENDESK_AUTO_ASSIGN_FIELD_ID, key: "auto_assign" },
  { id: ZENDESK_CLIENT_EMAIL_FIELD_ID, key: "client_email" },
  { id: ZENDESK_CLIENT_NAME_FIELD_ID, key: "client_name" },
  { id: ZENDESK_PROPERTY_ADDRESS_FIELD_ID, key: "property_address" },
  { id: ZENDESK_CLIENT_PHONE_FIELD_ID, key: "client_phone" },
  { id: ZENDESK_SCOPE_FIELD_ID, key: "scope" },
  { id: ZENDESK_REPLY_STATUS_FIELD_ID, key: "reply_status" },
];

const QUOTE_FIELD_KEYS: { id: number; key: string }[] = [
  { id: zendeskQuoteRefFieldId(), key: "quote_reference" },
  ...JOB_FIELD_KEYS.filter((f) => f.key !== "job_reference"),
];

async function resolveQuoteCatalogId(
  supabase: SupabaseClient,
  quote: { catalog_service_id?: string | null; service_type?: string | null },
): Promise<string | null> {
  const direct = quote.catalog_service_id?.trim();
  if (direct) return direct;
  const label = quote.service_type?.trim();
  if (!label) return null;
  const { data: rows } = await supabase
    .from("service_catalog")
    .select("id, name")
    .is("deleted_at", null)
    .eq("is_active", true);
  return catalogServiceIdForTypeOfWorkLabel(label, (rows ?? []) as { id: string; name: string }[]) ?? null;
}

function collectSyncedKeys(
  fields: TicketCustomFieldEntry[],
  keys: { id: number; key: string }[],
  extras: string[] = [],
): string[] {
  const out: string[] = [];
  for (const { id, key } of keys) {
    if (fields.some((f) => f.fieldId === id)) out.push(key);
  }
  return [...out, ...extras];
}

export async function syncJobZendeskFormFields(
  jobId: string,
  client?: SupabaseClient,
): Promise<ZendeskFormSyncResult> {
  const supabase = client ?? createServiceClient();
  const syncedFields: string[] = [];

  if (!isZendeskConfigured()) {
    return { ok: true, syncedFields, skipped: "zendesk_not_configured" };
  }

  const { data: job, error } = await supabase
    .from("jobs")
    .select(`
      id, reference, catalog_service_id, job_type,
      scheduled_start_at, scheduled_end_at,
      status, auto_assign_invited_partner_ids,
      client_name, property_address, scope,
      external_source, external_ref, partner_id,
      partners ( zendesk_user_id ),
      clients ( email, phone )
    `)
    .eq("id", jobId)
    .maybeSingle();

  if (error || !job) {
    return { ok: false, syncedFields, error: error?.message ?? "Job not found" };
  }

  const ticketId = getZendeskTicketId(job);
  if (!ticketId) {
    return { ok: true, syncedFields, skipped: "not_zendesk_linked" };
  }

  const fields = buildJobZendeskFormFieldEntries(
    job as Parameters<typeof buildJobZendeskFormFieldEntries>[0],
  );

  const partnerRow = (job as { partners?: { zendesk_user_id?: number | string | null } | { zendesk_user_id?: number | string | null }[] | null }).partners;
  const partner = Array.isArray(partnerRow) ? partnerRow[0] : partnerRow;
  const rawAssignee = partner?.zendesk_user_id;
  const assigneeId =
    (job as { partner_id?: string | null }).partner_id && rawAssignee != null
      ? Number(rawAssignee)
      : undefined;
  const assignee =
    assigneeId != null && Number.isFinite(assigneeId) ? assigneeId : undefined;

  if (fields.length === 0 && assignee == null) {
    return { ok: true, ticketId, syncedFields, skipped: "no_form_fields_configured" };
  }

  const r = await setTicketCustomFields({
    ticketId,
    fields,
    assigneeId: assignee ?? null,
  });

  if (r.ok) {
    syncedFields.push(...collectSyncedKeys(fields, JOB_FIELD_KEYS, assignee != null ? ["assignee"] : []));
  }

  if (!r.ok) {
    return { ok: false, ticketId, syncedFields, error: r.error ?? "zendesk_update_failed" };
  }

  return { ok: true, ticketId, syncedFields };
}

export async function syncQuoteZendeskFormFields(
  quoteId: string,
  client?: SupabaseClient,
): Promise<ZendeskFormSyncResult> {
  const supabase = client ?? createServiceClient();
  const syncedFields: string[] = [];

  if (!isZendeskConfigured()) {
    return { ok: true, syncedFields, skipped: "zendesk_not_configured" };
  }

  const { data: quote, error } = await supabase
    .from("quotes")
    .select(`
      id, reference, catalog_service_id, service_type,
      status, quote_type, start_date_option_1,
      client_email, client_name, property_address, scope,
      external_source, external_ref, partner_id, client_id,
      partners ( zendesk_user_id ),
      clients ( email, phone )
    `)
    .eq("id", quoteId)
    .maybeSingle();

  if (error || !quote) {
    return { ok: false, syncedFields, error: error?.message ?? "Quote not found" };
  }

  const ticketId = getZendeskTicketId(quote);
  if (!ticketId) {
    return { ok: true, syncedFields, skipped: "not_zendesk_linked" };
  }

  const catalogId = await resolveQuoteCatalogId(supabase, quote as {
    catalog_service_id?: string | null;
    service_type?: string | null;
  });

  const fields = buildQuoteZendeskFormFieldEntries({
    ...(quote as Parameters<typeof buildQuoteZendeskFormFieldEntries>[0]),
    catalog_service_id: catalogId,
  });

  const partnerRow = (quote as { partners?: { zendesk_user_id?: number | string | null } | { zendesk_user_id?: number | string | null }[] | null }).partners;
  const partner = Array.isArray(partnerRow) ? partnerRow[0] : partnerRow;
  const rawAssignee = partner?.zendesk_user_id;
  const assigneeId =
    (quote as { partner_id?: string | null }).partner_id && rawAssignee != null
      ? Number(rawAssignee)
      : undefined;
  const assignee =
    assigneeId != null && Number.isFinite(assigneeId) ? assigneeId : undefined;

  if (fields.length === 0 && assignee == null) {
    return { ok: true, ticketId, syncedFields, skipped: "no_form_fields_configured" };
  }

  const r = await setTicketCustomFields({
    ticketId,
    fields,
    assigneeId: assignee ?? null,
  });

  if (r.ok) {
    syncedFields.push(...collectSyncedKeys(fields, QUOTE_FIELD_KEYS, assignee != null ? ["assignee"] : []));
  }

  if (!r.ok) {
    return { ok: false, ticketId, syncedFields, error: r.error ?? "zendesk_update_failed" };
  }

  return { ok: true, ticketId, syncedFields };
}
