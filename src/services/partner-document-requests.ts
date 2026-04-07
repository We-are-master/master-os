import { getSupabase } from "./base";
import type { PartnerDocumentRequest } from "@/types/database";

/**
 * Service helpers for `partner_document_requests`.
 *
 * The dashboard side uses these via the authenticated client. The public
 * upload routes (`/api/partner-upload/*`) intentionally bypass this module
 * and use a service-role client directly so they don't accidentally inherit
 * an authenticated session.
 */

export interface CreatePartnerDocumentRequestInput {
  partner_id: string;
  requested_doc_types: string[];
  custom_message?: string | null;
  expires_at: string;
  requested_by?: string | null;
  requested_by_name?: string | null;
  sent_to_email?: string | null;
}

export async function createPartnerDocumentRequest(
  input: CreatePartnerDocumentRequestInput,
): Promise<PartnerDocumentRequest> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("partner_document_requests")
    .insert({
      partner_id: input.partner_id,
      requested_doc_types: input.requested_doc_types ?? [],
      custom_message: input.custom_message ?? null,
      expires_at: input.expires_at,
      requested_by: input.requested_by ?? null,
      requested_by_name: input.requested_by_name ?? null,
      sent_to_email: input.sent_to_email ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as PartnerDocumentRequest;
}

export async function listPartnerDocumentRequests(
  partnerId: string,
): Promise<PartnerDocumentRequest[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("partner_document_requests")
    .select("*")
    .eq("partner_id", partnerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PartnerDocumentRequest[];
}

export async function revokePartnerDocumentRequest(
  id: string,
  revokedBy?: string | null,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("partner_document_requests")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: revokedBy ?? null,
    })
    .eq("id", id);
  if (error) throw error;
}
