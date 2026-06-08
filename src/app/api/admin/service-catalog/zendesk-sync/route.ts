import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import {
  upsertCatalogOptionInZendesk,
  removeCatalogOptionFromZendesk,
  backfillCatalogOptionsToZendesk,
} from "@/lib/zendesk-service-catalog-sync";
import {
  backfillAllBandsToZendesk,
  syncBandsToZendesk,
} from "@/lib/zendesk-service-bands-sync";

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
 *   { catalogServiceId?: uuid, action?: "upsert" | "remove", dryRun?: boolean, syncBands?: boolean }
 *
 *   - catalogServiceId + action: act on a single row.
 *   - no catalogServiceId: backfill the whole active catalog.
 *   - dryRun: only meaningful for the backfill path; returns the planned
 *     inserted/updated/pruned counts without writing to Zendesk.
 *   - syncBands: when true (default on backfill), also mirror pricing bands
 *     into per-service Zendesk dropdown fields (EPC, FRA, EICR, PAT, GSC, FAC).
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

  let body: { catalogServiceId?: string; action?: string; dryRun?: boolean; syncBands?: boolean };
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
    let bands: Awaited<ReturnType<typeof syncBandsToZendesk>> | undefined;
    if (action === "upsert" && body.syncBands !== false) {
      const { data: row } = await db
        .from("service_catalog")
        .select("pricing_presets")
        .eq("id", catalogId)
        .is("deleted_at", null)
        .maybeSingle();
      bands = await syncBandsToZendesk(catalogId, (row as { pricing_presets?: unknown } | null)?.pricing_presets ?? [], {
        client: db,
      });
    }
    return NextResponse.json({ mode: "single", action, ...result, ...(bands ? { bands } : {}) });
  }

  // Backfill mode (no catalogServiceId)
  const result = await backfillCatalogOptionsToZendesk({
    client: db,
    dryRun: body.dryRun === true,
  });
  const bands =
    body.syncBands !== false
      ? await backfillAllBandsToZendesk({ client: db, dryRun: body.dryRun === true })
      : undefined;
  return NextResponse.json({
    mode: "backfill",
    dryRun: body.dryRun === true,
    ...result,
    ...(bands ? { bands } : {}),
  });
}
