import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createPartnerPortalLink } from "@/lib/partner-portal-link";
import { resolvePartnerTradePortalBaseUrl } from "@/lib/trade-auth";

const STAFF_ROLES = new Set(["admin", "manager", "operator"]);

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    return await handlePost(req, ctx);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    console.error("[partners/onboarding-link] unhandled", e);
    return NextResponse.json({ error: message || "Unexpected error generating link" }, { status: 500 });
  }
}

async function handlePost(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { createClient: createServerSupabase } = await import("@/lib/supabase/server");
  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();

  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!STAFF_ROLES.has(role)) {
    return NextResponse.json({ error: "Forbidden", message: "Staff role required" }, { status: 403 });
  }

  const { id: partnerId } = await ctx.params;
  if (!partnerId || !isValidUUID(partnerId)) {
    return NextResponse.json({ error: "Invalid partner id" }, { status: 400 });
  }

  let body: {
    sendEmail?: unknown;
    customMessage?: unknown;
    requestedDocIds?: unknown;
    expiresInDays?: unknown;
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const sendEmail = body.sendEmail === true;
  const customMessage = typeof body.customMessage === "string" ? body.customMessage : undefined;
  let requestedDocIds: string[] | null | undefined;
  if (body.requestedDocIds === null) {
    requestedDocIds = null;
  } else if (Array.isArray(body.requestedDocIds)) {
    requestedDocIds = body.requestedDocIds.filter((x): x is string => typeof x === "string");
  }

  const expiresInDays =
    typeof body.expiresInDays === "number" && Number.isFinite(body.expiresInDays)
      ? body.expiresInDays
      : undefined;

  const osBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || req.nextUrl.origin;
  const tradePortalBaseUrl = resolvePartnerTradePortalBaseUrl();
  const supabase = createServiceClient();

  try {
    const result = await createPartnerPortalLink(supabase, {
      partnerId,
      sendEmail,
      customMessage,
      requestedDocIds,
      expiresInDays,
      requestedByUserId: auth.user.id,
      osBaseUrl,
      tradePortalBaseUrl,
    });

    return NextResponse.json({
      ok: true,
      success: true,
      onboardingUrl: result.onboardingUrl,
      uploadUrl: result.onboardingUrl,
      shortUrl: result.shortUrl,
      url: result.fullUrl,
      fullUrl: result.fullUrl,
      expiresAt: result.expiresAt,
      tokenId: result.tokenId,
      sentTo: result.sentTo,
      emailSent: Boolean(result.emailSent),
      emailError: result.emailError ?? null,
      warning: result.warning,
    });
  } catch (e) {
    const err = e as Error & { status?: number };
    const status = err.status ?? 500;
    return NextResponse.json({ error: err.message ?? "Failed to create link" }, { status });
  }
}
