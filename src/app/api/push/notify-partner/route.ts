import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { safePostgrestEnumValue } from "@/lib/supabase/sanitize";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** Internal staff roles allowed to broadcast push notifications. */
const PUSH_ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

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
    const errors = (json?.data ?? []).filter((r: { status?: string }) => r.status === "error").length;
    return { sent: tokens.length - errors, errors };
  } catch (err) {
    console.error("[push/notify-partner] sendExpoPush fetch failed:", err);
    return { sent: 0, errors: tokens.length };
  }
}

export async function POST(req: NextRequest) {
  try {
    // ─── AUTH GATE ────────────────────────────────────────────────────────
    // Until 2026-04 this route was completely public — anyone with the URL
    // could broadcast push notifications to any partner. Now we require an
    // authenticated internal staff session.
    const authResult = await requireAuth();
    if (authResult instanceof NextResponse) return authResult;

    const serverSupabase = await createServerSupabase();
    const { data: profile } = await serverSupabase
      .from("profiles")
      .select("role")
      .eq("id", authResult.user.id)
      .maybeSingle();

    const role = (profile as { role?: string } | null)?.role ?? "";
    if (!PUSH_ALLOWED_ROLES.has(role)) {
      return NextResponse.json(
        { error: "Forbidden", message: "Staff role required to send notifications" },
        { status: 403 },
      );
    }

    const payload: NotifyPartnerBody = await req.json();
    const { partnerId, partnerIds, trades, title, body, data = {} } = payload;

    if (!title || !body) {
      return NextResponse.json({ error: "title and body are required" }, { status: 400 });
    }
    if (typeof title !== "string" || typeof body !== "string" || title.length > 200 || body.length > 2000) {
      return NextResponse.json({ error: "title or body invalid" }, { status: 400 });
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
      if (!isUuid(partnerId)) {
        return NextResponse.json({ error: "partnerId must be a UUID" }, { status: 400 });
      }
      /** Single round-trip: callers may pass either partners.id or partners.auth_user_id. */
      const { data: partnerRows } = await supabase
        .from("partners")
        .select("id, auth_user_id, expo_push_token")
        .or(`id.eq.${partnerId},auth_user_id.eq.${partnerId}`)
        .eq("status", "active")
        .limit(1);
      if (partnerRows && partnerRows.length > 0) {
        tokens = await resolveTokens(partnerRows as PartnerTokenRow[]);
      }
    } else if (partnerIds && partnerIds.length > 0) {
      const validIds = partnerIds.filter(isUuid);
      if (validIds.length === 0) {
        return NextResponse.json({ error: "partnerIds must contain valid UUIDs" }, { status: 400 });
      }
      /** Single round-trip for the bulk case as well — accepts ids that are either partners.id or auth_user_id. */
      const idList = validIds.join(",");
      const { data: partners } = await supabase
        .from("partners")
        .select("id, auth_user_id, expo_push_token")
        .or(`id.in.(${idList}),auth_user_id.in.(${idList})`)
        .eq("status", "active");
      tokens = await resolveTokens((partners ?? []) as PartnerTokenRow[]);
    } else if (trades && trades.length > 0) {
      // Sanitize each trade to defeat PostgREST filter injection. The .or()
      // string used to be built from raw user input — a value like
      // "a,status.eq.inactive" would have broken out of the trades clause.
      const safeTrades = trades
        .map((t) => safePostgrestEnumValue(String(t ?? "")))
        .filter((t): t is string => t != null);
      if (safeTrades.length === 0) {
        return NextResponse.json({ error: "No valid trades provided" }, { status: 400 });
      }
      // Find all active partners whose trades array overlaps the provided trades
      const orConditions = safeTrades
        .map((t) => `trades.cs.{${t}},trade.eq.${t}`)
        .join(",");
      const { data: partners } = await supabase
        .from("partners")
        .select("id, auth_user_id, expo_push_token")
        .or(orConditions)
        .eq("status", "active");
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
