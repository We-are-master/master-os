import type { NavGroup } from "@/lib/constants";

export type PermissionKey =
  | "dashboard"
  | "requests"
  | "quotes"
  | "jobs"
  | "partners"
  | "accounts"
  | "finance"
  | "settings"
  | "manage_team"
  | "manage_roles"
  | "delete_data"
  | "export_data";

export type RoleKey = "admin" | "manager" | "operator";

export type PermissionsByRole = Record<RoleKey, Record<PermissionKey, boolean>>;

/**
 * Per-user overrides stored in profiles.custom_permissions.
 * true  = explicitly granted (regardless of role default)
 * false = explicitly revoked (regardless of role default)
 * absent = inherit from role default
 */
export type UserPermissionOverride = Partial<Record<PermissionKey, boolean>>;

export type AdminConfigKeys = "navigation" | "permissions" | "system";

export type AdminConfig = {
  navigation: NavGroup[];
  permissions: PermissionsByRole;
  system?: Record<string, unknown>;
};
