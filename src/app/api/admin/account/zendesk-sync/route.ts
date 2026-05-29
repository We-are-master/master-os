import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { syncAccountToZendesk } from "@/lib/zendesk-account-sync";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * POST /api/admin/account/zendesk-sync
 *
 * Mirror an account into Zendesk (Organisation + User). Idempotent — safe to
 * re-run. Used by the dashboard right after `createAccount` so new accounts
 * show up in Zendesk immediately with the 🏢 prefix and `os_type=account`.
 *
 * Body: { accountId: uuid }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const supabase = await createServerSupabase();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { accountId?: string };
  try { body = (await req.json()) as { accountId?: string }; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const accountId = body.accountId?.trim();
  if (!accountId || !isValidUUID(accountId)) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  const result = await syncAccountToZendesk(accountId);
  return NextResponse.json(result);
}
