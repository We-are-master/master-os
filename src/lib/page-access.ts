import { redirect } from "next/navigation";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { loadMergedPermissions, resolvePermission } from "@/services/admin-config";
import type { PermissionKey, RoleKey, UserPermissionOverride } from "@/types/admin-config";

/**
 * Server-side page gate for dashboard segments. Call from a segment
 * `layout.tsx` so every page under it is protected even when reached by URL
 * (the sidebar filter is cosmetic — this is the enforcement).
 *
 * Admin role always passes. Everyone else resolves through the same engine
 * as the client `can()`: admin_config role matrix + profiles.custom_permissions.
 * No profiles row, or a deactivated one, fails closed.
 */
export async function requirePagePermission(
  permission: PermissionKey,
  opts?: { adminOnly?: boolean },
): Promise<void> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Service role when available (immune to future profiles RLS); the cookie
  // client is the fallback for environments without the key.
  const db = isServiceRoleConfigured() ? createServiceClient() : supabase;
  const { data: profile } = await db
    .from("profiles")
    .select("role, is_active, custom_permissions")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) redirect("/");
  if ((profile as { is_active?: boolean | null }).is_active === false) redirect("/auth/sign-out");

  const rawRole = (profile as { role?: string }).role ?? "operator";
  const role: RoleKey =
    rawRole === "admin" || rawRole === "manager" || rawRole === "operator" ? rawRole : "operator";
  if (role === "admin") return;
  // adminOnly mirrors the nav's ADMIN_ONLY_NAV_HREFS: the permission matrix
  // can never open this page for manager/operator.
  if (opts?.adminOnly) redirect("/");

  const overrides = (profile as { custom_permissions?: UserPermissionOverride | null })
    .custom_permissions;
  const permissions = await loadMergedPermissions(db);
  const rolePerms = permissions[role];
  if (!rolePerms || !resolvePermission(permission, role, rolePerms, overrides)) {
    redirect("/");
  }
}
