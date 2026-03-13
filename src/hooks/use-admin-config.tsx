"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { NavGroup } from "@/lib/constants";
import type { PermissionKey, PermissionsByRole, RoleKey, UserPermissionOverride } from "@/types/admin-config";
import { getAdminConfig, setAdminConfig as saveAdminConfig } from "@/services/admin-config";
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
  const { profile } = useProfile();

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
      const rolePerms = permissions[role];
      if (!rolePerms) return false;
      // User-level override takes priority over role default
      const overrides = profile.custom_permissions as UserPermissionOverride | null | undefined;
      if (overrides && (permission as PermissionKey) in overrides) {
        return overrides[permission as PermissionKey] === true;
      }
      return (rolePerms as Record<string, boolean>)[permission] === true;
    },
    [profile, permissions]
  );

  const filteredNavigation = useCallback((): NavGroup[] => {
    if (!profile || navigation.length === 0) return navigation;
    // Admin sees everything
    if (profile.role === "admin") return navigation;
    const role = profile.role as RoleKey;
    const rolePerms = permissions[role];
    const overrides = profile.custom_permissions as UserPermissionOverride | null | undefined;

    return navigation
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (!item.permission) return true;
          const perm = item.permission as PermissionKey;
          // User override takes priority
          if (overrides && perm in overrides) return overrides[perm] === true;
          if (!rolePerms) return false;
          return (rolePerms as Record<string, boolean>)[perm] === true;
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [navigation, permissions, profile]);

  const value: AdminConfigState = {
    navigation,
    permissions,
    loading,
    canEditConfig: canEditConfig ?? false,
    refresh,
    setNavigation,
    setPermissions,
    can,
    filteredNavigation: filteredNavigation(),
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
