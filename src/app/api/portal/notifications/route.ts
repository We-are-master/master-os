import { NextResponse } from "next/server";
import { requirePortalUser } from "@/lib/portal-auth";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/portal/notifications
 * Returns the authenticated portal user's most recent notifications with
 * an unread count. Uses the service client only to avoid the cost of
 * re-checking RLS — the auth gate already binds us to one portal user.
 */
export async function GET() {
  const auth = await requirePortalUser();
  if (auth instanceof NextResponse) return auth;

  const admin = createServiceClient();
  const { data: rows, error } = await admin
    .from("portal_notifications")
    .select("id, type, title, body, link_url, entity_type, entity_id, read_at, created_at")
    .eq("account_id", auth.accountId)
    .or(`portal_user_id.is.null,portal_user_id.eq.${auth.user.id}`)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    console.error("[portal/notifications]", error);
    return NextResponse.json({ error: "Failed to load notifications" }, { status: 500 });
  }

  const notifications = rows ?? [];
  const unread = notifications.filter((n) => !(n as { read_at: string | null }).read_at).length;
  return NextResponse.json({ notifications, unread });
}
