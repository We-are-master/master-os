import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { CANONICAL_TYPE_OF_WORK_NAMES } from "@/lib/type-of-work";
import { loadMergedPermissions, resolvePermission } from "@/services/admin-config";
import type { PermissionKey, RoleKey, UserPermissionOverride } from "@/types/admin-config";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/service-catalog/sync-canonical
 * Inserts missing rows for each canonical type of work (same defaults as migration 174).
 * Idempotent: skips names that already exist (case-insensitive, non-deleted rows).
 */
export async function POST() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role, custom_permissions")
    .eq("id", auth.user.id)
    .maybeSingle();

  const rawRole = (profile as { role?: string } | null)?.role ?? "operator";
  const role: RoleKey =
    rawRole === "admin" || rawRole === "manager" || rawRole === "operator" ? rawRole : "operator";
  const overrides = (profile as { custom_permissions?: UserPermissionOverride | null } | null)
    ?.custom_permissions;

  const permissions = await loadMergedPermissions(serverSupabase);
  const rolePerms = permissions[role];
  if (
    !rolePerms ||
    !resolvePermission("service_catalog" as PermissionKey, role, rolePerms, overrides)
  ) {
    return NextResponse.json({ error: "Forbidden", message: "Service catalog permission required" }, { status: 403 });
  }

  const db = isServiceRoleConfigured() ? createServiceClient() : serverSupabase;

  const { data: existingRows, error: fetchErr } = await db
    .from("service_catalog")
    .select("name")
    .is("deleted_at", null);

  if (fetchErr) {
    return NextResponse.json(
      { error: "Database error", message: fetchErr.message },
      { status: 500 },
    );
  }

  const existing = new Set(
    (existingRows ?? []).map((r) => (r as { name: string }).name.trim().toLowerCase()),
  );

  let created = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < CANONICAL_TYPE_OF_WORK_NAMES.length; i++) {
    const name = CANONICAL_TYPE_OF_WORK_NAMES[i];
    const key = name.trim().toLowerCase();
    if (existing.has(key)) {
      skipped++;
      continue;
    }

    const sort_order = (i + 1) * 10;
    const { error: insErr } = await db.from("service_catalog").insert({
      name,
      pricing_mode: "fixed",
      fixed_price: 0,
      hourly_rate: 0,
      default_hours: 1,
      partner_cost: 0,
      pricing_presets: [],
      default_description: name,
      sort_order,
      is_active: true,
      created_at: now,
      updated_at: now,
    });

    if (insErr) {
      return NextResponse.json(
        { error: "Insert failed", message: insErr.message },
        { status: 500 },
      );
    }

    existing.add(key);
    created++;
  }

  return NextResponse.json({ ok: true, created, skipped });
}
