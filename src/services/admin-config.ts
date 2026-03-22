import { getSupabase } from "./base";
import type { NavGroup } from "@/lib/constants";
import type { PermissionKey, PermissionsByRole, RoleKey, UserPermissionOverride } from "@/types/admin-config";

/** Injected into stored navigation if missing (older admin_config rows). */
const SERVICES_NAV_ITEM = {
  label: "Services",
  href: "/services",
  icon: "wrench",
  permission: "service_catalog" as const,
};

function ensureServicesNavItem(nav: NavGroup[]): NavGroup[] {
  if (nav.some((g) => g.items.some((i) => i.href === "/services"))) return nav;
  const next = nav.map((g) => ({ ...g, items: [...g.items] }));
  const ops = next.find((g) => g.label === "Operations");
  if (ops) {
    const rIdx = ops.items.findIndex((i) => i.href === "/requests");
    ops.items.splice(rIdx >= 0 ? rIdx + 1 : 0, 0, { ...SERVICES_NAV_ITEM });
    return next;
  }
  return [{ label: "Operations", items: [{ ...SERVICES_NAV_ITEM }] }, ...next];
}

function mergePermissionsWithDefaults(stored: PermissionsByRole): PermissionsByRole {
  const roles: RoleKey[] = ["admin", "manager", "operator"];
  const out = { ...stored };
  for (const role of roles) {
    out[role] = { ...DEFAULT_PERMISSIONS[role], ...(stored[role] ?? {}) } as Record<PermissionKey, boolean>;
  }
  return out;
}

const DEFAULT_NAVIGATION: NavGroup[] = [
  { label: "Overview", items: [{ label: "Dashboard", href: "/", icon: "grid-2x2", permission: "dashboard" }] },
  {
    label: "Operations",
    items: [
      { label: "Requests", href: "/requests", icon: "inbox", permission: "requests" },
      { label: "Services", href: "/services", icon: "wrench", permission: "service_catalog" },
      { label: "Quotes", href: "/quotes", icon: "file-text", permission: "quotes" },
      { label: "Jobs", href: "/jobs", icon: "briefcase", permission: "jobs" },
      { label: "Schedule", href: "/schedule", icon: "calendar", permission: "jobs" },
    ],
  },
  {
    label: "Network",
    items: [
      { label: "Clients", href: "/clients", icon: "user-circle", permission: "partners" },
      { label: "Partners", href: "/partners", icon: "users", permission: "partners" },
      { label: "Accounts", href: "/accounts", icon: "building", permission: "accounts" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Invoices", href: "/finance/invoices", icon: "receipt", permission: "finance" },
      { label: "Self-billing", href: "/finance/selfbill", icon: "wallet", permission: "finance" },
      { label: "Bills", href: "/finance/bills", icon: "file-check", permission: "finance" },
      { label: "Payroll", href: "/finance/payroll", icon: "circle-dollar-sign", permission: "finance" },
      { label: "Pay Run", href: "/finance/pay-run", icon: "calendar-clock", permission: "finance" },
    ],
  },
  { label: "Team", items: [{ label: "Team", href: "/team", icon: "users-2", permission: "team" }] },
  { label: "Admin", items: [{ label: "Settings", href: "/settings", icon: "settings", permission: "settings" }] },
];

const DEFAULT_PERMISSIONS: PermissionsByRole = {
  admin: {
    dashboard: true,
    requests: true,
    quotes: true,
    jobs: true,
    service_catalog: true,
    partners: true,
    accounts: true,
    finance: true,
    team: true,
    settings: true,
    manage_team: true,
    manage_roles: true,
    delete_data: true,
    export_data: true,
  },
  manager: {
    dashboard: true,
    requests: true,
    quotes: true,
    jobs: true,
    service_catalog: false,
    partners: true,
    accounts: true,
    finance: true,
    team: true,
    settings: false,
    manage_team: false,
    manage_roles: false,
    delete_data: false,
    export_data: true,
  },
  operator: {
    dashboard: true,
    requests: true,
    quotes: true,
    jobs: true,
    service_catalog: false,
    partners: false,
    accounts: false,
    finance: false,
    team: false,
    settings: false,
    manage_team: false,
    manage_roles: false,
    delete_data: false,
    export_data: false,
  },
};

export async function getAdminConfig<K extends keyof { navigation: NavGroup[]; permissions: PermissionsByRole }>(
  key: K
): Promise<K extends "navigation" ? NavGroup[] : K extends "permissions" ? PermissionsByRole : never> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("admin_config").select("value").eq("key", key).maybeSingle();
  if (key === "navigation") {
    if (error || !data) return DEFAULT_NAVIGATION as never;
    return ensureServicesNavItem(data.value as NavGroup[]) as never;
  }
  if (key === "permissions") {
    if (error || !data) return DEFAULT_PERMISSIONS as never;
    return mergePermissionsWithDefaults(data.value as PermissionsByRole) as never;
  }
  return DEFAULT_PERMISSIONS as never;
}

export async function setAdminConfig(
  key: "navigation" | "permissions",
  value: NavGroup[] | PermissionsByRole
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("admin_config")
    .upsert({ key, value: value as unknown as Record<string, unknown>, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/** Persist per-user permission overrides to profiles.custom_permissions. Pass null to clear all overrides. */
export async function saveUserPermissions(
  userId: string,
  overrides: UserPermissionOverride | null
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("profiles")
    .update({ custom_permissions: overrides && Object.keys(overrides).length > 0 ? overrides : null })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

/**
 * Resolve the effective boolean for a single permission for a given user,
 * applying user overrides on top of the role defaults.
 * Admin role always returns true regardless of overrides.
 */
export function resolvePermission(
  permission: PermissionKey,
  role: RoleKey,
  rolePerms: Record<PermissionKey, boolean>,
  overrides: UserPermissionOverride | null | undefined
): boolean {
  if (role === "admin") return true;
  if (overrides && permission in overrides) return overrides[permission] === true;
  return rolePerms[permission] ?? false;
}

/**
 * Build the full effective permissions map for a user (12 keys → boolean).
 */
export function resolveEffectivePermissions(
  role: RoleKey,
  rolePerms: Record<PermissionKey, boolean>,
  overrides: UserPermissionOverride | null | undefined
): Record<PermissionKey, boolean> {
  const keys = Object.keys(rolePerms) as PermissionKey[];
  return Object.fromEntries(
    keys.map((k) => [k, resolvePermission(k, role, rolePerms, overrides)])
  ) as Record<PermissionKey, boolean>;
}
