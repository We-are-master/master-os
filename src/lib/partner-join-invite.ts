import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePartnerPortalCredential } from "@/lib/partner-portal-session";

export type PartnerJoinInvitePayload = {
  partnerId: string;
  expiresAt: string;
  email: string;
  contactName: string;
  companyName: string;
  phone: string;
  partnerAddress: string;
  trades: string[];
  utr: string;
};

/** Public join invite resolved from `partner_portal_tokens.short_code`. */
export async function resolvePartnerJoinInvite(
  supabase: SupabaseClient,
  inviteCode: string,
): Promise<PartnerJoinInvitePayload | null> {
  const session = await resolvePartnerPortalCredential(inviteCode);
  if (!session) return null;
  if (session.requestedDocIds != null && session.requestedDocIds.length > 0) {
    return null;
  }

  const { data: partner, error } = await supabase
    .from("partners")
    .select(
      "id, email, contact_name, company_name, phone, partner_address, trade, trades, utr, auth_user_id",
    )
    .eq("id", session.partnerId)
    .maybeSingle();

  if (error || !partner) return null;
  if ((partner as { auth_user_id?: string | null }).auth_user_id) return null;

  const p = partner as {
    id: string;
    email?: string | null;
    contact_name?: string | null;
    company_name?: string | null;
    phone?: string | null;
    partner_address?: string | null;
    trade?: string | null;
    trades?: string[] | null;
    utr?: string | null;
  };

  const email = p.email?.trim() ?? "";
  if (!email) return null;

  const trades =
    p.trades?.length && p.trades.some((t) => t?.trim())
      ? p.trades.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      : p.trade?.trim()
        ? [p.trade.trim()]
        : [];

  return {
    partnerId: p.id,
    expiresAt: session.expiresAt,
    email,
    contactName: p.contact_name?.trim() ?? "",
    companyName: p.company_name?.trim() ?? "",
    phone: p.phone?.trim() ?? "",
    partnerAddress: p.partner_address?.trim() ?? "",
    trades,
    utr: p.utr?.trim() ?? "",
  };
}
