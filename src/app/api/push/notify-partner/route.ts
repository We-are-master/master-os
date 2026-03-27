import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface NotifyPartnerBody {
  /** Notify a single partner by their partners.id */
  partnerId?: string;
  /** Notify all partners whose trades array overlaps with any of these trade values */
  trades?: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

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
    const { partnerId, trades, title, body, data = {} } = payload;

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

    if (partnerId) {
      const { data: partner } = await supabase
        .from("partners")
        .select("expo_push_token")
        .eq("id", partnerId)
        .eq("status", "active")
        .single();
      if (partner?.expo_push_token) tokens = [partner.expo_push_token];
    } else if (trades && trades.length > 0) {
      // Find all active partners whose trades array overlaps the provided trades
      const orConditions = trades
        .map((t) => `trades.cs.{${t}},trade.eq.${t}`)
        .join(",");
      const { data: partners } = await supabase
        .from("partners")
        .select("expo_push_token")
        .or(orConditions)
        .eq("status", "active")
        .not("expo_push_token", "is", null);
      tokens = (partners ?? [])
        .map((p: { expo_push_token: string | null }) => p.expo_push_token!)
        .filter(Boolean);
    } else {
      return NextResponse.json({ error: "partnerId or trades is required" }, { status: 400 });
    }

    const result = await sendExpoPush(tokens, title, body, data);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[push/notify-partner]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
