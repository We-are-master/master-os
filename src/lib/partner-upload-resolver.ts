import type { SupabaseClient } from "@supabase/supabase-js";
import { isLikelyPartnerUploadSlug, verifyPartnerUploadToken } from "./partner-upload-token";

/**
 * Resolves a partner-upload `token` parameter to its underlying request_id + partner_id.
 *
 * The public routes accept BOTH the legacy long HMAC token AND the new short slug, so
 * existing emails / generated links keep working. This helper centralises that fallback
 * so all three public endpoints stay in lockstep.
 *
 * Returns null if the value isn't valid by either route. The caller still has to re-check
 * the row's revoked_at / expires_at — this only resolves identity.
 */
export interface ResolvedPartnerUpload {
  requestId: string;
  partnerId: string;
  /** Which path resolved it — useful for logging / metrics. */
  via: "token" | "slug";
}

export async function resolvePartnerUploadToken(
  supabase: SupabaseClient,
  rawToken: string,
): Promise<ResolvedPartnerUpload | null> {
  const value = (rawToken ?? "").trim();
  if (!value) return null;

  /** Try the long signed token first — cheap, no DB hit on success. */
  const payload = verifyPartnerUploadToken(value);
  if (payload) {
    return { requestId: payload.requestId, partnerId: payload.partnerId, via: "token" };
  }

  /** Fall back to slug lookup — only if it shape-matches a slug to avoid stray DB hits. */
  if (!isLikelyPartnerUploadSlug(value)) return null;

  const { data, error } = await supabase
    .from("partner_document_requests")
    .select("id, partner_id")
    .eq("slug", value)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as { id: string; partner_id: string };
  return { requestId: row.id, partnerId: row.partner_id, via: "slug" };
}
