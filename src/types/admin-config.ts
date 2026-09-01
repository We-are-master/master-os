import type { NavGroup } from "@/lib/constants";

export type PermissionKey =
  | "dashboard"
  | "requests"
  | "leads"
  | "quotes"
  | "jobs"
  | "service_catalog"
  | "partners"
  | "accounts"
  | "finance"
  | "team"
  | "settings"
  | "manage_team"
  | "manage_roles"
  | "delete_data"
  | "export_data";

export type RoleKey = "admin" | "manager" | "operator";

/** Canonical list of permission keys — single source for validation and pickers. */
export const PERMISSION_KEYS: readonly PermissionKey[] = [
  "dashboard",
  "requests",
  "leads",
  "quotes",
  "jobs",
  "service_catalog",
  "partners",
  "accounts",
  "finance",
  "team",
  "settings",
  "manage_team",
  "manage_roles",
  "delete_data",
  "export_data",
] as const;

export type PermissionsByRole = Record<RoleKey, Record<PermissionKey, boolean>>;

/**
 * Per-user overrides stored in profiles.custom_permissions.
 * true  = explicitly granted (regardless of role default)
 * false = explicitly revoked (regardless of role default)
 * absent = inherit from role default
 */
export type UserPermissionOverride = Partial<Record<PermissionKey, boolean>>;

/**
 * Validate an untrusted custom_permissions payload (API body). Returns the
 * cleaned override map (unknown keys dropped, values coerced to real booleans),
 * null for an explicit clear, or undefined when the payload is not usable.
 */
export function sanitizePermissionOverrides(
  input: unknown,
): UserPermissionOverride | null | undefined {
  if (input === null) return null;
  if (typeof input !== "object" || Array.isArray(input)) return undefined;
  const entries = Object.keys(input as Record<string, unknown>);
  const out: UserPermissionOverride = {};
  for (const key of PERMISSION_KEYS) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === "boolean") out[key] = v;
  }
  if (Object.keys(out).length > 0) return out;
  // {} is an explicit "clear all overrides"; an object that HAD entries but
  // none valid is garbage — reject it instead of silently clearing.
  return entries.length === 0 ? null : undefined;
}

export type AdminConfigKeys = "navigation" | "permissions" | "system";

export type AdminConfig = {
  navigation: NavGroup[];
  permissions: PermissionsByRole;
  system?: Record<string, unknown>;
};
