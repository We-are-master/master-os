import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { isValidUUID, requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { retryNotifyPartnersForQuote } from "@/lib/quote-retry-notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * POST /api/quotes/:id/retry-notify
 *
 * Re-triggers partner match + bid invites for bidding quotes created without
 * property_address (0 partners notified on create).
 *
 * Auth: `X-API-Key` (MASTER_OS_QUOTE_WEBHOOK_API_KEY) for n8n/Zendesk, or
 * logged-in admin/manager/operator from the OS UI.
 *
 * Body (optional): { property_address?: string }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: quoteId } = await ctx.params;
  if (!isValidUUID(quoteId)) {
    return NextResponse.json({ error: "Invalid quote id." }, { status: 400 });
  }

  let body: { property_address?: string } = {};
  try {
    const raw = await req.json();
    if (raw && typeof raw === "object") body = raw as { property_address?: string };
  } catch {
    /* empty body OK */
  }

  const apiKey = req.headers.get("x-api-key");
  const expectedKey = process.env.MASTER_OS_QUOTE_WEBHOOK_API_KEY?.trim();
  let invitedBy: string | null = null;

  if (apiKey && expectedKey && secretsMatch(apiKey, expectedKey)) {
    /* webhook */
  } else {
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
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    invitedBy = auth.user.id;
  }

  const supabase = createServiceClient();
  const result = await retryNotifyPartnersForQuote(supabase, {
    quoteId,
    propertyAddressOverride: body.property_address ?? null,
    invitedBy,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    id: result.id,
    reference: result.reference,
    status: result.status,
    partners_notified: result.partners_notified,
  });
}
