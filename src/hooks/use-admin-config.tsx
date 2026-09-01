"use client";

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import type { NavGroup, NavItem } from "@/lib/constants";
import { ADMIN_ONLY_NAV_HREFS, NAVIGATION } from "@/lib/constants";
import { mergeNewNavItems } from "@/lib/nav-merge";
import type { PermissionKey, PermissionsByRole, RoleKey, UserPermissionOverride } from "@/types/admin-config";
import { getAdminConfig, setAdminConfig as saveAdminConfig, DEFAULT_PERMISSIONS } from "@/services/admin-config";
import { useProfile } from "@/hooks/use-profile";

type AdminConfigState = {
  navigation: NavGroup[];
  permissions: PermissionsByRole;
  loading: boolean;
  /** Only the Admin profile can change navigation, permissions and system configuration. */
  canEditConfig: boolean;
  refresh: () => Promise<void>;
  setNavigation: (nav: NavGroup[]) => Promise<void>;
  setPermissions: (perms: PermissionsByRole) => Promise<void>;
  can: (permission: string) => boolean;
  filteredNavigation: NavGroup[];
};

const AdminConfigContext = createContext<AdminConfigState | null>(null);

export function AdminConfigProvider({ children }: { children: React.ReactNode }) {
  const [navigation, setNavigationState] = useState<NavGroup[]>([]);
  const [permissions, setPermissionsState] = useState<PermissionsByRole>({} as PermissionsByRole);
  const [loading, setLoading] = useState(true);
  const { profile, loading: profileLoading } = useProfile();

  // Before admin_config loads (or after a failed refresh) the matrix is {} —
  // filtering against it would drop EVERY item with a permission. The code
  // defaults are the honest stand-in until the stored matrix arrives.
  const effectivePermissions = useMemo(
    () => (Object.keys(permissions).length > 0 ? permissions : DEFAULT_PERMISSIONS),
    [permissions],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nav, perms] = await Promise.all([
        getAdminConfig("navigation"),
        getAdminConfig("permissions"),
      ]);
      setNavigationState(nav);
      setPermissionsState(perms);
    } catch {
      setNavigationState([]);
      setPermissionsState({} as PermissionsByRole);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const canEditConfig = profile?.role === "admin";

  const setNavigation = useCallback(async (nav: NavGroup[]) => {
    if (profile?.role !== "admin") {
      throw new Error("Only the Admin profile can change system configuration.");
    }
    await saveAdminConfig("navigation", nav);
    setNavigationState(nav);
  }, [profile?.role]);

  const setPermissions = useCallback(async (perms: PermissionsByRole) => {
    if (profile?.role !== "admin") {
      throw new Error("Only the Admin profile can change permissions.");
    }
    await saveAdminConfig("permissions", perms);
    setPermissionsState(perms);
  }, [profile?.role]);

  const can = useCallback(
    (permission: string): boolean => {
      if (!profile) return false;
      // Admin role always has full access — overrides cannot remove it
      if (profile.role === "admin") return true;
      const role = profile.role as RoleKey;
      // User-level override takes priority over role default — checked FIRST,
      // same order as itemAllowed below and resolvePermission on the server.
      const overrides = profile.custom_permissions as UserPermissionOverride | null | undefined;
      if (overrides && (permission as PermissionKey) in overrides) {
        return overrides[permission as PermissionKey] === true;
      }
      const rolePerms = effectivePermissions[role];
      if (!rolePerms) return false;
      return (rolePerms as Record<string, boolean>)[permission] === true;
    },
    [profile, effectivePermissions]
  );

  const filteredNavigation = useMemo((): NavGroup[] => {
    // Merge canonical items FIRST, filter AFTER — merging after the filter
    // used to re-inject everything the filter removed (fail-open sidebar).
    const merged = mergeNewNavItems(navigation, NAVIGATION);
    // While the profile is still loading, render nothing rather than flashing
    // the full nav at a user who is about to be filtered (fail closed).
    if (!profile) return profileLoading ? [] : merged;
    // Admin sees everything
    if (profile.role === "admin") return merged;
    const role = profile.role as RoleKey;
    const rolePerms = effectivePermissions[role];
    const overrides = profile.custom_permissions as UserPermissionOverride | null | undefined;

    function itemAllowed(perm?: string): boolean {
      if (!perm) return true;
      const p = perm as PermissionKey;
      if (overrides && p in overrides) return overrides[p] === true;
      if (!rolePerms) return false;
      return (rolePerms as Record<string, boolean>)[perm] === true;
    }

    function filterNestedItems(items: NavItem[]): NavItem[] {
      const out: NavItem[] = [];
      for (const item of items) {
        // Admin-only items are never shown to non-admins, regardless of the
        // permissions config. Admins skip this whole branch (early return above).
        if (ADMIN_ONLY_NAV_HREFS.has(item.href)) continue;
        const childList = item.children?.length ? filterNestedItems(item.children) : [];
        const selfOk = itemAllowed(item.permission);
        const hasKids = childList.length > 0;

        if (!selfOk && hasKids) {
          out.push(...childList);
          continue;
        }
        if (!selfOk) continue;

        const nextEntry: NavItem =
          childList.length > 0 ? { ...item, children: childList } : { ...item, children: undefined };
        out.push(nextEntry);
      }
      return out;
    }

    return merged
      .map((group) => ({
        ...group,
        items: filterNestedItems(group.items),
      }))
      .filter((group) => group.items.length > 0);
  }, [navigation, effectivePermissions, profile, profileLoading]);

  const value: AdminConfigState = {
    navigation,
    permissions,
    loading,
    canEditConfig: canEditConfig ?? false,
    refresh,
    setNavigation,
    setPermissions,
    can,
    filteredNavigation,
  };

  return (
    <AdminConfigContext.Provider value={value}>
      {children}
    </AdminConfigContext.Provider>
  );
}

export function useAdminConfig(): AdminConfigState {
  const ctx = useContext(AdminConfigContext);
  if (!ctx) {
    throw new Error("useAdminConfig must be used within AdminConfigProvider");
  }
  return ctx;
}

export function useAdminConfigOptional(): AdminConfigState | null {
  return useContext(AdminConfigContext);
}
