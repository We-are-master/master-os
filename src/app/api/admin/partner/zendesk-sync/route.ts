import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { syncPartnerToZendesk } from "@/lib/zendesk-partner-sync";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * POST /api/admin/partner/zendesk-sync
 *
 * Mirror a partner into Zendesk (create-or-update Organisation + User). Used
 * by the dashboard right after createPartner returns, so the new partner is
 * immediately Zendesk-linked and side conversations can target them.
 *
 * Idempotent — re-running with the same partner just updates the existing
 * records (Zendesk dedupes by external_id).
 *
 * Body: { partnerId: uuid }
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

  let body: { partnerId?: string };
  try { body = (await req.json()) as { partnerId?: string }; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const partnerId = body.partnerId?.trim();
  if (!partnerId || !isValidUUID(partnerId)) {
    return NextResponse.json({ error: "partnerId required" }, { status: 400 });
  }

  const result = await syncPartnerToZendesk(partnerId);
  return NextResponse.json(result, { status: result.ok ? 200 : 200 });
}
