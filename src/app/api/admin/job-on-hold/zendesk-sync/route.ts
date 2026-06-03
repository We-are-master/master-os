import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { normalizeJobOnHoldPresets, parseFrontendSetup } from "@/lib/frontend-setup";
import type { JobOnHoldPresetRow } from "@/lib/job-on-hold-reasons";
import { backfillOnHoldPresetsToZendesk } from "@/lib/zendesk-job-on-hold-reasons-sync";
import { resolveZendeskComplaintFieldIds, zendeskOnHoldReasonFieldConfigured } from "@/lib/zendesk-field-ids";
import { isZendeskConfigured } from "@/lib/zendesk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * POST /api/admin/job-on-hold/zendesk-sync
 *
 * Push OS on-hold reason presets into the Zendesk dropdown field
 * (Settings → Setup field id or ZENDESK_ON_HOLD_REASON_FIELD_ID env).
 *
 * Body: { dryRun?: boolean, presets?: { id: string; label: string }[] }
 *   — pass current UI list to sync before Save Setup.
 */
export async function GET() {
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

  const db = isServiceRoleConfigured() ? createServiceClient() : serverSupabase;
  const { data: row } = await db.from("company_settings").select("frontend_setup").limit(1).maybeSingle();
  const setup = parseFrontendSetup(row?.frontend_setup ?? null);
  const ids = resolveZendeskComplaintFieldIds(setup);

  return NextResponse.json({
    zendeskApiConfigured: isZendeskConfigured(),
    onHoldReasonFieldConfigured: zendeskOnHoldReasonFieldConfigured(setup),
    onHoldReasonFieldId: ids.onHoldReasonFieldId > 0 ? ids.onHoldReasonFieldId : null,
    fromSettings: Boolean(setup?.zendesk_on_hold_reason_field_id),
    fromEnv: ids.onHoldReasonFieldId > 0 && !setup?.zendesk_on_hold_reason_field_id,
  });
}

export async function POST(req: NextRequest) {
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

  let body: { dryRun?: boolean; presets?: JobOnHoldPresetRow[] } = {};
  try {
    body = (await req.json().catch(() => ({}))) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = isServiceRoleConfigured() ? createServiceClient() : serverSupabase;
  const { data: row } = await db.from("company_settings").select("frontend_setup").limit(1).maybeSingle();
  const setup = parseFrontendSetup(row?.frontend_setup ?? null);

  const presetsFromBody = Array.isArray(body.presets)
    ? normalizeJobOnHoldPresets(body.presets)
    : undefined;

  const result = await backfillOnHoldPresetsToZendesk({
    setup,
    presets: presetsFromBody,
    client: db,
    dryRun: body.dryRun === true,
  });

  const userMessage =
    result.skipped === "on_hold_reason_field_id_not_configured"
      ? "Set the on-hold reason field id under Integrations · Zendesk (below), then Save Setup — or set ZENDESK_ON_HOLD_REASON_FIELD_ID in env."
      : result.skipped === "zendesk_api_not_configured"
        ? "Zendesk API is not configured (ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN)."
        : result.error ?? null;

  return NextResponse.json({ dryRun: body.dryRun === true, userMessage, ...result });
}
