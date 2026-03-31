import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface NotifyPartnerBody {
  /** Notify a single partner by their partners.id */
  partnerId?: string;
  /** Notify these partners only (by partners.id). */
  partnerIds?: string[];
  /** Notify all partners whose trades array overlaps with any of these trade values */
  trades?: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

type PartnerTokenRow = {
  id: string;
  auth_user_id: string | null;
  expo_push_token: string | null;
};

async function sendExpoPush(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, unknown>
): Promise<{ sent: number; errors: number }> {
  if (!tokens.length) return { sent: 0, errors: 0 };
  const messages = tokens.map((to) => ({ to, title, body, data, sound: "default" }));
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[push/notify-partner] Expo API error ${res.status}:`, text);
      return { sent: 0, errors: tokens.length };
    }
    const json = await res.json();
    const errors = (json?.data ?? []).filter((r: any) => r.status === "error").length;
    return { sent: tokens.length - errors, errors };
  } catch (err) {
    console.error("[push/notify-partner] sendExpoPush fetch failed:", err);
    return { sent: 0, errors: tokens.length };
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload: NotifyPartnerBody = await req.json();
    const { partnerId, partnerIds, trades, title, body, data = {} } = payload;

    if (!title || !body) {
      return NextResponse.json({ error: "title and body are required" }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      console.error("[push/notify-partner] Missing Supabase env vars");
      return NextResponse.json({ error: "Server not configured" }, { status: 503 });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    let tokens: string[] = [];

    const resolveTokens = async (rows: PartnerTokenRow[]): Promise<string[]> => {
      const byPartner = (rows ?? [])
        .map((r) => r.expo_push_token)
        .filter((t): t is string => !!t);
      const missingAuthUserIds = (rows ?? [])
        .filter((r) => !r.expo_push_token && !!r.auth_user_id)
        .map((r) => r.auth_user_id!) as string[];
      if (missingAuthUserIds.length === 0) return [...new Set(byPartner)];

      const { data: users } = await supabase
        .from("users")
        .select("id, fcmToken")
        .in("id", missingAuthUserIds)
        .not("fcmToken", "is", null);
      const fromUsers = (users ?? [])
        .map((u: { fcmToken: string | null }) => u.fcmToken)
        .filter((t): t is string => !!t);
      return [...new Set([...byPartner, ...fromUsers])];
    };

    if (partnerId) {
      const { data: partnerById } = await supabase
        .from("partners")
        .select("id, auth_user_id, expo_push_token")
        .eq("id", partnerId)
        .eq("status", "active")
        .single();
      if (partnerById) {
        tokens = await resolveTokens([partnerById as PartnerTokenRow]);
      } else {
        // Fallback: some callers may pass auth_user_id instead of partners.id.
        const { data: partnerByAuth } = await supabase
          .from("partners")
          .select("id, auth_user_id, expo_push_token")
          .eq("auth_user_id", partnerId)
          .eq("status", "active")
          .single();
        if (partnerByAuth) tokens = await resolveTokens([partnerByAuth as PartnerTokenRow]);
      }
    } else if (partnerIds && partnerIds.length > 0) {
      const { data: partners } = await supabase
        .from("partners")
        .select("id, auth_user_id, expo_push_token")
        .in("id", partnerIds)
        .eq("status", "active")
      let rows = (partners ?? []) as PartnerTokenRow[];
      if (rows.length < partnerIds.length) {
        // Fallback for ids that are actually auth_user_id values.
        const { data: byAuth } = await supabase
          .from("partners")
          .select("id, auth_user_id, expo_push_token")
          .in("auth_user_id", partnerIds)
          .eq("status", "active");
        rows = [...rows, ...((byAuth ?? []) as PartnerTokenRow[])];
      }
      tokens = await resolveTokens(rows);
    } else if (trades && trades.length > 0) {
      // Find all active partners whose trades array overlaps the provided trades
      const orConditions = trades
        .map((t) => `trades.cs.{${t}},trade.eq.${t}`)
        .join(",");
      const { data: partners } = await supabase
        .from("partners")
        .select("id, auth_user_id, expo_push_token")
        .or(orConditions)
        .eq("status", "active")
      tokens = await resolveTokens((partners ?? []) as PartnerTokenRow[]);
    } else {
      return NextResponse.json({ error: "partnerId, partnerIds, or trades is required" }, { status: 400 });
    }

    const result = await sendExpoPush(tokens, title, body, data);
    return NextResponse.json({
      ...result,
      tokensFound: tokens.length,
    });
  } catch (err) {
    console.error("[push/notify-partner]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
