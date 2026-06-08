import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { parseFrontendSetup } from "@/lib/frontend-setup";
import { resolveOfficeJobCancellationPresets } from "@/lib/frontend-setup";
import { syncReasonsToZendesk } from "@/services/zendesk-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * POST /api/admin/job-cancellation/zendesk-sync
 *
 * Push OS cancellation reason presets into the Zendesk dropdown field.
 * Body: { dryRun?: boolean }
 */
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

  let body: { dryRun?: boolean } = {};
  try {
    body = (await req.json().catch(() => ({}))) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = isServiceRoleConfigured() ? createServiceClient() : serverSupabase;
  const { data: row } = await db.from("company_settings").select("frontend_setup").limit(1).maybeSingle();
  const setup = parseFrontendSetup(row?.frontend_setup ?? null);

  const presets = resolveOfficeJobCancellationPresets(setup);
  const result = await syncReasonsToZendesk(
    "cancel",
    presets.map((p) => ({ id: p.id, label: p.label })),
    { setup, dryRun: body.dryRun === true },
  );

  return NextResponse.json({ dryRun: body.dryRun === true, ...result });
}
