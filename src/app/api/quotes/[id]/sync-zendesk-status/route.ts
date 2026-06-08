import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncQuoteZendeskStatus } from "@/lib/zendesk-status-sync";
import { syncQuoteZendeskFormFields } from "@/lib/zendesk-ticket-form-sync";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * POST /api/quotes/[id]/sync-zendesk-status
 *
 * Syncs linked Zendesk ticket custom_status_id and ticket form fields from the quote.
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
  const [result, formFields] = await Promise.all([
    syncQuoteZendeskStatus(quoteId, admin),
    syncQuoteZendeskFormFields(quoteId, admin),
  ]);

  return NextResponse.json({
    ok: result.ok && formFields.ok,
    synced: result.synced,
    ticketId: result.ticketId ?? formFields.ticketId ?? null,
    customStatusId: result.customStatusId ?? null,
    skip: result.skip ?? null,
    error: result.error ?? formFields.error ?? null,
    formFields: {
      ok: formFields.ok,
      syncedFields: formFields.syncedFields,
      skip: formFields.skipped ?? null,
      error: formFields.error ?? null,
    },
  });
}
