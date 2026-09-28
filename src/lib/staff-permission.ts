import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { loadMergedPermissions, resolvePermission } from "@/services/admin-config";
import type { AuthResult } from "@/lib/auth-api";
import type { PermissionKey, RoleKey, UserPermissionOverride } from "@/types/admin-config";

/**
 * API-side twin of the client `can()` and `requirePagePermission`: role matrix
 * from admin_config + profiles.custom_permissions. Admin always passes.
 * Returns the caller's role, or a 403 response.
 */
export async function requireStaffPermission(
  auth: AuthResult,
  permission: PermissionKey,
): Promise<{ role: RoleKey } | NextResponse> {
  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role, is_active, custom_permissions")
    .eq("id", auth.user.id)
    .maybeSingle();

  const forbidden = NextResponse.json(
    { error: "Forbidden", message: `Permission required: ${permission}` },
    { status: 403 },
  );
  if (!profile || (profile as { is_active?: boolean | null }).is_active === false) return forbidden;

  const rawRole = (profile as { role?: string }).role ?? "operator";
  const role: RoleKey =
    rawRole === "admin" || rawRole === "manager" || rawRole === "operator" ? rawRole : "operator";
  if (role === "admin") return { role };

  const overrides = (profile as { custom_permissions?: UserPermissionOverride | null }).custom_permissions;
  const permissions = await loadMergedPermissions(serverSupabase);
  const rolePerms = permissions[role];
  if (!rolePerms || !resolvePermission(permission, role, rolePerms, overrides)) return forbidden;
  return { role };
}

/**
 * The partner login routes (email, password, app row) take a raw auth user id.
 * A non-admin with manage_partners may only point them at a partner login:
 * a plain operator profile (partner logins are operator; admin/manager never),
 * no custom OS access, no Workforce row, and linked to a partner or to partner
 * work. Otherwise "reset partner password" would be a way into any OS account.
 * Staff logins that double as test partners (guilherme@, victor@voshq) pass —
 * they carry operator defaults only, nothing above the caller's own access.
 */
export async function assertPartnerLoginTarget(
  admin: SupabaseClient,
  userId: string,
): Promise<NextResponse | null> {
  const deny = (message: string) => NextResponse.json({ error: "Forbidden", message }, { status: 403 });

  const [{ data: profile }, { data: workforce }, { data: partner }, { data: job }] = await Promise.all([
    admin.from("profiles").select("role, custom_permissions").eq("id", userId).maybeSingle(),
    admin.from("payroll_internal_costs").select("id").eq("profile_id", userId).limit(1),
    admin.from("partners").select("id").eq("auth_user_id", userId).limit(1),
    admin.from("jobs").select("id").eq("partner_id", userId).limit(1),
  ]);

  const p = profile as { role?: string; custom_permissions?: Record<string, unknown> | null } | null;
  if (p?.role && p.role !== "operator") return deny("Admin and manager accounts can only be changed by an admin");
  if (p?.custom_permissions && Object.keys(p.custom_permissions).length > 0) {
    return deny("Staff accounts can only be changed by an admin");
  }
  if ((workforce ?? []).length > 0) return deny("Staff accounts can only be changed by an admin");
  if ((partner ?? []).length === 0 && (job ?? []).length === 0) {
    return deny("Not a partner login");
  }
  return null;
}
