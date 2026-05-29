import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import {
  upsertCatalogOptionInZendesk,
  removeCatalogOptionFromZendesk,
  backfillCatalogOptionsToZendesk,
} from "@/lib/zendesk-service-catalog-sync";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * POST /api/admin/service-catalog/zendesk-sync
 *
 * Mirror service_catalog rows (Type of Work entries) into the Zendesk
 * Type of Work tagger ticket field (env ZENDESK_TYPE_OF_WORK_FIELD_ID).
 * Idempotent — safe to re-run. Used:
 *   - From the dashboard after createCatalogService / updateCatalogService
 *     for an explicit resync.
 *   - As a manual backfill button (no body) to push the entire active
 *     catalog after migration 202 or whenever Zendesk drifts.
 *
 * Body (all optional):
 *   { catalogServiceId?: uuid, action?: "upsert" | "remove", dryRun?: boolean }
 *
 *   - catalogServiceId + action: act on a single row.
 *   - no catalogServiceId: backfill the whole active catalog.
 *   - dryRun: only meaningful for the backfill path; returns the planned
 *     inserted/updated/pruned counts without writing to Zendesk.
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

  let body: { catalogServiceId?: string; action?: string; dryRun?: boolean };
  try {
    body = (await req.json().catch(() => ({}))) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = isServiceRoleConfigured() ? createServiceClient() : serverSupabase;

  // Single-row mode
  const catalogId = body.catalogServiceId?.trim();
  if (catalogId) {
    if (!isValidUUID(catalogId)) {
      return NextResponse.json({ error: "catalogServiceId must be a UUID" }, { status: 400 });
    }
    const action = body.action === "remove" ? "remove" : "upsert";
    const result = action === "remove"
      ? await removeCatalogOptionFromZendesk(catalogId, { client: db })
      : await upsertCatalogOptionInZendesk(catalogId,    { client: db });
    return NextResponse.json({ mode: "single", action, ...result });
  }

  // Backfill mode (no catalogServiceId)
  const result = await backfillCatalogOptionsToZendesk({
    client: db,
    dryRun: body.dryRun === true,
  });
  return NextResponse.json({ mode: "backfill", dryRun: body.dryRun === true, ...result });
}
