import { getSupabase, queryList, type ListParams, type ListResult } from "./base";
import type { Lead, LeadStatus, LeadUrgency } from "@/types/database";
import { allocateClientForLead, type LeadClientAllocationInput } from "@/lib/lead-client-allocation";
import {
  formatLeadPhoneDisplay,
  normalizeLeadEmail,
  normalizeLeadPostcode,
  validateLeadForm,
} from "@/lib/lead-validation";

function postgrestErrorMessage(err: { message?: string; details?: string; hint?: string }): string {
  const parts = [err.message, err.details, err.hint]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  return parts.length ? parts.join(" — ") : "Database request failed";
}

function isMissingLeadsColumnError(err: { message?: string; code?: string }): boolean {
  const m = (err.message ?? "").toLowerCase();
  return (
    err.code === "PGRST204" ||
    m.includes("schema cache") ||
    (m.includes("column") && (m.includes("email") || m.includes("client_id") || m.includes("address")))
  );
}

export async function listLeads(params: ListParams): Promise<ListResult<Lead>> {
  return queryList<Lead>("leads", params, {
    searchColumns: ["reference", "name", "email", "phone", "address", "scope"],
    defaultSort: "created_at",
  });
}

export async function getLead(id: string): Promise<Lead | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(postgrestErrorMessage(error));
  return (data as Lead | null) ?? null;
}

export type CreateLeadInput = LeadClientAllocationInput & {
  urgency?: LeadUrgency;
  scope?: string;
  status?: LeadStatus;
  owner_id?: string | null;
};

export async function createLead(input: CreateLeadInput): Promise<Lead> {
  const formInput = {
    name: input.name,
    email: input.email,
    phone: input.phone,
    address: input.address,
    scope: input.scope ?? "",
  };
  const errors = validateLeadForm(formInput);
  const first = Object.values(errors)[0];
  if (first) throw new Error(first);

  const supabase = getSupabase();
  const { accountId, clientId, clientAddressId } = await allocateClientForLead(supabase, {
    name: input.name,
    email: input.email,
    phone: input.phone,
    address: input.address,
    city: input.city,
    postcode: input.postcode,
  });

  const { data: refData, error: refErr } = await supabase.rpc("next_lead_ref");
  if (refErr) throw new Error(postgrestErrorMessage(refErr));
  const reference = String(refData ?? "").trim();
  if (!reference) throw new Error("Could not generate lead reference");

  const addressLine = [input.address.trim(), input.city?.trim(), input.postcode?.trim()]
    .filter(Boolean)
    .join(", ");
  const postcode = normalizeLeadPostcode(input.postcode, addressLine);

  const payload: Record<string, unknown> = {
    reference,
    name: input.name.trim(),
    email: normalizeLeadEmail(input.email),
    phone: formatLeadPhoneDisplay(input.phone),
    address: input.address.trim(),
    city: input.city?.trim() || null,
    postcode,
    urgency: input.urgency ?? "medium",
    scope: (input.scope ?? "").trim(),
    status: input.status ?? "new",
    owner_id: input.owner_id ?? null,
    client_id: clientId,
    client_address_id: clientAddressId,
    account_id: accountId,
  };

  const { data, error } = await supabase.from("leads").insert(payload).select("*").single();
  if (error) {
    if (isMissingLeadsColumnError(error)) {
      throw new Error("Leads contact fields are not in the database yet. Run migration 197_leads_contact_client.sql.");
    }
    throw new Error(postgrestErrorMessage(error));
  }
  return data as Lead;
}

export type UpdateLeadInput = Partial<
  Pick<
    Lead,
    | "name"
    | "email"
    | "phone"
    | "address"
    | "city"
    | "postcode"
    | "urgency"
    | "scope"
    | "status"
    | "owner_id"
    | "published_at"
  >
>;

export async function updateLead(id: string, patch: UpdateLeadInput): Promise<Lead> {
  const supabase = getSupabase();
  const existing = await getLead(id);
  if (!existing) throw new Error("Lead not found");

  const merged = {
    name: patch.name ?? existing.name,
    email: patch.email ?? existing.email ?? "",
    phone: patch.phone ?? existing.phone ?? "",
    address: patch.address ?? existing.address ?? "",
    city: patch.city ?? existing.city ?? "",
    postcode: patch.postcode ?? existing.postcode ?? "",
    scope: patch.scope ?? existing.scope,
  };

  const errors = validateLeadForm({
    name: merged.name,
    email: merged.email,
    phone: merged.phone,
    address: merged.address,
    scope: merged.scope,
  });
  const first = Object.values(errors)[0];
  if (first) throw new Error(first);

  const { accountId, clientId, clientAddressId } = await allocateClientForLead(supabase, merged);

  const addressLine = [merged.address.trim(), merged.city?.trim(), merged.postcode?.trim()]
    .filter(Boolean)
    .join(", ");

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    name: merged.name.trim(),
    email: normalizeLeadEmail(merged.email),
    phone: formatLeadPhoneDisplay(merged.phone),
    address: merged.address.trim(),
    city: merged.city?.trim() || null,
    postcode: normalizeLeadPostcode(merged.postcode, addressLine),
    scope: merged.scope.trim(),
    client_id: clientId,
    client_address_id: clientAddressId,
    account_id: accountId,
  };

  if (patch.urgency !== undefined) payload.urgency = patch.urgency;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.owner_id !== undefined) payload.owner_id = patch.owner_id;
  if (patch.published_at !== undefined) payload.published_at = patch.published_at;

  const { data, error } = await supabase
    .from("leads")
    .update(payload)
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .single();

  if (error) {
    if (isMissingLeadsColumnError(error)) {
      throw new Error("Leads contact fields are not in the database yet. Run migration 197_leads_contact_client.sql.");
    }
    throw new Error(postgrestErrorMessage(error));
  }
  return data as Lead;
}
