/**
 * Zendesk macro → POST /api/jobs field reconciliation.
 *
 * Checkatrade and some B2B forms store client email in the field the OS maps as
 * property_address; the real street address may live in the Zendesk custom field.
 * The ticket subject is never used for address — only payload.property_address
 * (or the ticket property-address field when the payload holds an email).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { jobHasPartnerSet } from "@/lib/job-partner-assign";
import { extractUkPostcode } from "@/lib/uk-postcode";
import { isValidUUID } from "@/lib/auth-api";
import {
  getZendeskTicketSnapshot,
  ZENDESK_AUTO_ASSIGN_FIELD_ID,
  ZENDESK_CLIENT_EMAIL_FIELD_ID,
  ZENDESK_CLIENT_NAME_FIELD_ID,
  ZENDESK_PROPERTY_ADDRESS_FIELD_ID,
  ZENDESK_TYPE_OF_WORK_FIELD_ID,
} from "@/lib/zendesk";

export function parseAutoAssignFlag(body: Record<string, unknown>): boolean {
  if (body.auto_assign === true) return true;
  const raw = String(body.auto_assign ?? "").trim().toLowerCase();
  if (/^(true|1|yes|on)$/.test(raw)) return true;
  if (String(body.assignment_mode ?? "").trim().toLowerCase() === "auto") return true;
  return false;
}

function parseZendeskBoolField(value: string | null | undefined): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

function looksLikeEmail(value: string | null | undefined): boolean {
  const v = String(value ?? "").trim();
  return v.includes("@") && !/\s/.test(v);
}

function namesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = String(a ?? "").trim().toLowerCase();
  const y = String(b ?? "").trim().toLowerCase();
  return x.length > 0 && x === y;
}

function fieldValue(fields: Record<number, string>, fieldId: number): string | null {
  if (!(fieldId > 0)) return null;
  const v = fields[fieldId]?.trim();
  return v || null;
}

/**
 * Canonical property address for Zendesk job ingest.
 * Never parses the ticket subject — payload (or ticket address field when payload is email).
 */
export function resolveZendeskPropertyAddress(
  bodyAddress: string,
  ticketAddressField: string | null,
): { address: string; swappedEmail: string | null; correction?: string } {
  const trimmed = bodyAddress.trim();
  const fieldTrimmed = ticketAddressField?.trim() ?? "";

  if (trimmed && !looksLikeEmail(trimmed)) {
    return { address: trimmed, swappedEmail: null };
  }

  if (fieldTrimmed && !looksLikeEmail(fieldTrimmed)) {
    return {
      address: fieldTrimmed,
      swappedEmail: looksLikeEmail(trimmed) ? trimmed.toLowerCase() : null,
      correction: "property_address_from_ticket_field",
    };
  }

  if (trimmed) {
    return {
      address: trimmed,
      swappedEmail: looksLikeEmail(trimmed) ? trimmed.toLowerCase() : null,
    };
  }

  if (fieldTrimmed && !looksLikeEmail(fieldTrimmed)) {
    return {
      address: fieldTrimmed,
      swappedEmail: null,
      correction: "property_address_from_ticket_field",
    };
  }

  return {
    address: "",
    swappedEmail: looksLikeEmail(trimmed) ? trimmed.toLowerCase() : null,
  };
}

export type ZendeskJobIngestInput = {
  ticketId: string;
  clientName: string;
  clientEmail: string | null;
  propertyAddress: string;
  autoAssign: boolean;
  catalogServiceId: string | null;
  accountCompanyName: string | null;
};

export type ZendeskJobIngestResult = ZendeskJobIngestInput & {
  corrections: string[];
};

/** Reconcile macro body fields against the linked Zendesk ticket. */
export async function reconcileZendeskJobIngest(
  input: ZendeskJobIngestInput,
): Promise<ZendeskJobIngestResult> {
  const corrections: string[] = [];
  let clientName = input.clientName.trim();
  let clientEmail = input.clientEmail;
  let propertyAddress = input.propertyAddress.trim();
  let autoAssign = input.autoAssign;
  let catalogServiceId = input.catalogServiceId;

  const snap = await getZendeskTicketSnapshot(input.ticketId);
  if (!snap.ok || !snap.ticket) {
    return { ...input, clientName, clientEmail, propertyAddress, autoAssign, catalogServiceId, corrections };
  }

  const { fields } = snap.ticket;
  const ticketClientName = fieldValue(fields, ZENDESK_CLIENT_NAME_FIELD_ID);
  const ticketClientEmail = fieldValue(fields, ZENDESK_CLIENT_EMAIL_FIELD_ID);
  const ticketAutoAssign = fieldValue(fields, ZENDESK_AUTO_ASSIGN_FIELD_ID);
  const ticketCatalog = fieldValue(fields, ZENDESK_TYPE_OF_WORK_FIELD_ID);
  const ticketPropertyAddress = fieldValue(fields, ZENDESK_PROPERTY_ADDRESS_FIELD_ID);

  if (!autoAssign && parseZendeskBoolField(ticketAutoAssign)) {
    autoAssign = true;
    corrections.push("auto_assign_from_ticket");
  }

  if (
    ticketClientName &&
    (namesEqual(clientName, input.accountCompanyName) || !clientName)
  ) {
    clientName = ticketClientName;
    corrections.push("client_name_from_ticket");
  }

  const addrFix = resolveZendeskPropertyAddress(propertyAddress, ticketPropertyAddress);
  if (addrFix.correction) {
    propertyAddress = addrFix.address;
    corrections.push(addrFix.correction);
  } else if (addrFix.address && addrFix.address !== propertyAddress) {
    propertyAddress = addrFix.address;
    corrections.push("property_address_from_ticket_field");
  } else if (addrFix.address) {
    propertyAddress = addrFix.address;
  }

  if (addrFix.swappedEmail && !clientEmail) {
    clientEmail = addrFix.swappedEmail.toLowerCase();
    corrections.push("client_email_from_address_field");
  } else if (!clientEmail && ticketClientEmail && looksLikeEmail(ticketClientEmail)) {
    clientEmail = ticketClientEmail.toLowerCase();
    corrections.push("client_email_from_ticket");
  }

  if (!catalogServiceId && ticketCatalog) {
    const normalizedCatalog = ticketCatalog.replace(/^os_/i, "");
    if (isValidUUID(normalizedCatalog)) {
      catalogServiceId = normalizedCatalog;
      corrections.push("catalog_service_id_from_ticket");
    }
  }

  return {
    ticketId: input.ticketId,
    clientName,
    clientEmail,
    propertyAddress,
    autoAssign,
    catalogServiceId,
    accountCompanyName: input.accountCompanyName,
    corrections,
  };
}

/** Service type label used for partner trade matching on a job row. */
export async function resolveJobMatchServiceType(
  supabase: SupabaseClient,
  job: { title?: string | null; catalog_service_id?: string | null },
): Promise<{ serviceType: string; catalogServiceId: string | null }> {
  const catalogId = job.catalog_service_id?.trim() || null;
  if (catalogId) {
    const { data } = await supabase
      .from("service_catalog")
      .select("name")
      .eq("id", catalogId)
      .is("deleted_at", null)
      .maybeSingle();
    const name = (data as { name?: string } | null)?.name?.trim();
    if (name) return { serviceType: name, catalogServiceId: catalogId };
  }
  return { serviceType: (job.title ?? "").trim(), catalogServiceId: catalogId };
}

export type JobZendeskRepairPatch = {
  client_name?: string;
  property_address?: string;
  status?: string;
  catalog_service_id?: string | null;
};

/** Repair an existing Zendesk-linked job row before auto-assign / partner pickers. */
export async function repairJobIngestFromZendeskTicket(
  supabase: SupabaseClient,
  job: {
    id: string;
    reference: string;
    client_name: string | null;
    property_address: string | null;
    status: string;
    partner_id?: string | null;
    partner_ids?: string[] | null;
    catalog_service_id?: string | null;
    external_source?: string | null;
    external_ref?: string | null;
  },
  accountCompanyName?: string | null,
): Promise<{ patch: JobZendeskRepairPatch; corrections: string[] }> {
  const ticketId =
    job.external_source === "zendesk" ? job.external_ref?.trim() || null : null;
  if (!ticketId) return { patch: {}, corrections: [] };

  const reconciled = await reconcileZendeskJobIngest({
    ticketId,
    clientName: job.client_name?.trim() || "",
    clientEmail: null,
    propertyAddress: job.property_address?.trim() || "",
    autoAssign: job.status === "auto_assigning" && !jobHasPartnerSet(job),
    catalogServiceId: job.catalog_service_id?.trim() || null,
    accountCompanyName: accountCompanyName ?? null,
  });

  const patch: JobZendeskRepairPatch = {};
  if (
    reconciled.clientName &&
    reconciled.clientName !== (job.client_name ?? "").trim()
  ) {
    patch.client_name = reconciled.clientName;
  }
  if (
    reconciled.propertyAddress &&
    reconciled.propertyAddress !== (job.property_address ?? "").trim()
  ) {
    patch.property_address = reconciled.propertyAddress;
  }
  if (reconciled.catalogServiceId && !job.catalog_service_id) {
    patch.catalog_service_id = reconciled.catalogServiceId;
  }
  if (reconciled.autoAssign && job.status === "unassigned" && !jobHasPartnerSet(job)) {
    patch.status = "auto_assigning";
  }

  return { patch, corrections: reconciled.corrections };
}
