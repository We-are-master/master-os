import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncQuoteZendeskStatus } from "@/lib/zendesk-status-sync";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * POST /api/quotes/[id]/sync-zendesk-status
 *
 * Manual trigger for `syncQuoteZendeskStatus` — flips the linked Zendesk
 * ticket's custom_status_id to match the quote's current internal status
 * (e.g. bidding → Bidding). Mirrors the job endpoint; the Create Quote modal
 * fires this right after creating an OS quote so the ticket doesn't stay open.
 *
 * Auth: admin/manager/operator only.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: quoteId } = await ctx.params;
  if (!isValidUUID(quoteId)) {
    return NextResponse.json({ error: "Invalid quote id" }, { status: 400 });
  }

  const admin = createServiceClient();
  const result = await syncQuoteZendeskStatus(quoteId, admin);

  return NextResponse.json({
    ok: result.ok,
    synced: result.synced,
    ticketId: result.ticketId ?? null,
    customStatusId: result.customStatusId ?? null,
    skip: result.skip ?? null,
    error: result.error ?? null,
  });
}
