import { NextResponse } from "next/server";
import { requirePortalUser } from "@/lib/portal-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { isValidUUID } from "@/lib/auth-api";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/notifications/[id]/read
 * Marks a single notification as read. Idempotent.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePortalUser();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const admin = createServiceClient();
  const { error } = await admin
    .from("portal_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("account_id", auth.accountId)
    .is("read_at", null);
  if (error) {
    console.error("[portal/notifications/read]", error);
    return NextResponse.json({ error: "Failed to mark as read" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
