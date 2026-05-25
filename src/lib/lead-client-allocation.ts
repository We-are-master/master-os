import type { SupabaseClient } from "@supabase/supabase-js";
import { getFixfyAccountId } from "@/lib/fixfy-account";
import {
  formatLeadPhoneDisplay,
  normalizeLeadEmail,
  normalizeLeadPostcode,
} from "@/lib/lead-validation";
import { normalizePhoneDigits } from "@/lib/duplicate-create-warnings";
import { createClient, updateClient } from "@/services/clients";
import { createClientAddress, listAddressesByClient, setDefaultClientAddress } from "@/services/client-addresses";

export type LeadClientAllocationInput = {
  name: string;
  email: string;
  phone: string;
  address: string;
  city?: string;
  postcode?: string;
};

export type LeadClientAllocationResult = {
  accountId: string;
  clientId: string;
  clientAddressId: string | null;
};

function buildFullAddressLine(input: LeadClientAllocationInput): string {
  const parts = [input.address.trim(), input.city?.trim(), input.postcode?.trim()].filter(Boolean);
  return parts.join(", ");
}

async function findClientByEmailUnderAccount(
  supabase: SupabaseClient,
  accountId: string,
  email: string,
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("id")
    .eq("source_account_id", accountId)
    .ilike("email", email)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string } | null;
}

async function upsertDefaultAddress(
  clientId: string,
  input: LeadClientAllocationInput,
): Promise<string | null> {
  const line = buildFullAddressLine(input);
  if (!line.trim()) return null;

  const postcode = normalizeLeadPostcode(input.postcode, line);
  const existing = await listAddressesByClient(clientId);
  const norm = line.toLowerCase().replace(/\s+/g, " ");
  const match = existing.find(
    (a) => a.address.toLowerCase().replace(/\s+/g, " ") === norm,
  );
  if (match) {
    if (!match.is_default) await setDefaultClientAddress(clientId, match.id);
    return match.id;
  }

  const created = await createClientAddress({
    client_id: clientId,
    label: "Lead",
    address: input.address.trim(),
    city: input.city?.trim() || undefined,
    postcode: postcode ?? undefined,
    country: "UK",
    is_default: existing.length === 0,
  });

  if (existing.length > 0) {
    await setDefaultClientAddress(clientId, created.id);
  }
  return created.id;
}

/**
 * Creates or updates a client under the Fixfy corporate account and optional default address.
 */
export async function allocateClientForLead(
  supabase: SupabaseClient,
  input: LeadClientAllocationInput,
): Promise<LeadClientAllocationResult> {
  const accountId = await getFixfyAccountId(supabase);
  const email = normalizeLeadEmail(input.email);
  const phoneDisplay = formatLeadPhoneDisplay(input.phone);
  const phoneDigits = normalizePhoneDigits(input.phone);
  const addressLine = buildFullAddressLine(input);
  const postcode = normalizeLeadPostcode(input.postcode, addressLine);

  const existing = await findClientByEmailUnderAccount(supabase, accountId, email);

  let clientId: string;
  if (existing?.id) {
    clientId = existing.id;
    await updateClient(clientId, {
      full_name: input.name.trim(),
      email,
      phone: phoneDisplay,
      address: addressLine || undefined,
      city: input.city?.trim() || undefined,
      postcode: postcode ?? undefined,
      source_account_id: accountId,
    });
  } else {
    const created = await createClient({
      full_name: input.name.trim(),
      email,
      phone: phoneDisplay,
      address: addressLine,
      city: input.city?.trim() || "",
      postcode: postcode ?? "",
      client_type: "residential",
      source: "direct",
      status: "active",
      source_account_id: accountId,
      notes: "",
    });
    clientId = created.id;
  }

  const clientAddressId = await upsertDefaultAddress(clientId, input);

  return { accountId, clientId, clientAddressId };
}
