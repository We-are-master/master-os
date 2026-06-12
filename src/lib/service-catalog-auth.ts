import { NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { loadMergedPermissions, resolvePermission } from "@/services/admin-config";
import type { AuthResult } from "@/lib/auth-api";
import type { PermissionKey, RoleKey, UserPermissionOverride } from "@/types/admin-config";

/** Require authenticated user with `service_catalog` permission. */
export async function requireServiceCatalogAuth(
  auth: AuthResult,
): Promise<NextResponse | null> {
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
    return NextResponse.json(
      { error: "Forbidden", message: "Service catalog permission required" },
      { status: 403 },
    );
  }

  return null;
}
