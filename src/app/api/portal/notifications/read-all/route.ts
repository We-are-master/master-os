import { NextResponse } from "next/server";
import { requirePortalUser } from "@/lib/portal-auth";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/notifications/read-all
 * Marks every unread notification for this portal user as read.
 */
export async function POST() {
  const auth = await requirePortalUser();
  if (auth instanceof NextResponse) return auth;

  const admin = createServiceClient();
  const { error } = await admin
    .from("portal_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("account_id", auth.accountId)
    .or(`portal_user_id.is.null,portal_user_id.eq.${auth.user.id}`)
    .is("read_at", null);
  if (error) {
    console.error("[portal/notifications/read-all]", error);
    return NextResponse.json({ error: "Failed to mark all as read" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
