import { createServiceClient } from "@/lib/supabase/service";
import { hashPartnerPortalToken } from "@/lib/partner-portal-crypto";

export type ResolvedPartnerPortalSession = {
  partnerId: string;
  tokenRowId: string;
  expiresAt: string;
  /**
   * When set, the portal may upload only these requirement ids (`photo_id`, `dbs`, …).
   * `null` = legacy token (unrestricted full checklist).
   */
  requestedDocIds: string[] | null;
};

type PortalTokenRow = {
  id: string;
  partner_id: string;
  expires_at: string;
  requested_doc_ids: unknown;
};

function mapTokenRow(data: PortalTokenRow): ResolvedPartnerPortalSession | null {
  if (!data?.partner_id || !data.expires_at) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;

  const rawIds = data.requested_doc_ids as unknown;
  let requestedDocIds: string[] | null = null;
  if (Array.isArray(rawIds)) {
    requestedDocIds = rawIds.filter((x): x is string => typeof x === "string" && x.length > 0);
  }

  return {
    partnerId: data.partner_id as string,
    tokenRowId: data.id as string,
    expiresAt: data.expires_at as string,
    requestedDocIds,
  };
}

export async function resolvePartnerPortalToken(rawToken: string): Promise<ResolvedPartnerPortalSession | null> {
  const t = rawToken?.trim();
  if (!t || t.length < 16) return null;
  const tokenHash = hashPartnerPortalToken(t);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("partner_portal_tokens")
    .select("id, partner_id, expires_at, requested_doc_ids")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) return null;
  return mapTokenRow(data as PortalTokenRow);
}

/** Resolves either a long `token=` URL value (hex) or a short `code=` value. */
export async function resolvePartnerPortalCredential(credential: string): Promise<ResolvedPartnerPortalSession | null> {
  const t = credential?.trim();
  if (!t) return null;

  const looksLikeShortCode = t.length <= 12 && /^[a-z0-9]+$/i.test(t);
  if (looksLikeShortCode) {
    const supabase = createServiceClient();
    const code = t.toLowerCase();
    const { data, error } = await supabase
      .from("partner_portal_tokens")
      .select("id, partner_id, expires_at, requested_doc_ids")
      .eq("short_code", code)
      .maybeSingle();

    if (!error && data) {
      const mapped = mapTokenRow(data as PortalTokenRow);
      if (mapped) return mapped;
    }
  }

  return resolvePartnerPortalToken(t);
}
