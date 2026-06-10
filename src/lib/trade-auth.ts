import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

export interface TradePartnerRow {
  id: string;
  email: string;
  company_name: string;
  auth_user_id: string | null;
  status: string;
}

export interface TradeAuthResult {
  user: User;
  partner: TradePartnerRow;
}

/**
 * Auth gate for the Fixfy Trade portal (`/trade/*` and `/api/trade/*`).
 * Requires a Supabase session linked to a `partners.auth_user_id` row.
 */
export async function requireTradePartner(): Promise<TradeAuthResult | NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Authentication required" },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }

  const { data: row, error: rowErr } = await supabase
    .from("partners")
    .select("id, email, company_name, auth_user_id, status")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (rowErr || !row) {
    return NextResponse.json(
      { error: "Forbidden", message: "Trade portal access required" },
      { status: 403 },
    );
  }

  return { user, partner: row as TradePartnerRow };
}

export async function verifyTradePartnerSession(userId: string): Promise<TradePartnerRow | null> {
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("partners")
    .select("id, email, company_name, auth_user_id, status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  return (row as TradePartnerRow | null) ?? null;
}

const PARTNER_TRADE_PORTAL_DEFAULT = "https://partners.getfixfy.com";

/** Public base URL for Fixfy Trade (partners.getfixfy.com). Used in onboarding emails/links. */
export function resolvePartnerTradePortalBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_PARTNER_APP_URL?.trim().replace(/\/$/, "") ||
    PARTNER_TRADE_PORTAL_DEFAULT
  );
}

export function resolveTradePortalRedirectUrl(): string {
  return resolvePartnerTradePortalBaseUrl();
}
