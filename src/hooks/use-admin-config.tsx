"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { NavGroup } from "@/lib/constants";
import type { PermissionsByRole, RoleKey } from "@/types/admin-config";
import { getAdminConfig, setAdminConfig as saveAdminConfig } from "@/services/admin-config";
import { useProfile } from "@/hooks/use-profile";

type AdminConfigState = {
  navigation: NavGroup[];
  permissions: PermissionsByRole;
  loading: boolean;
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

  const setNavigation = useCallback(async (nav: NavGroup[]) => {
    await saveAdminConfig("navigation", nav);
    setNavigationState(nav);
  }, []);

  const setPermissions = useCallback(async (perms: PermissionsByRole) => {
    await saveAdminConfig("permissions", perms);
    setPermissionsState(perms);
  }, []);

  const can = useCallback(
    (permission: string): boolean => {
      const role = (profile?.role ?? "operator") as RoleKey;
      const rolePerms = permissions[role];
      if (!rolePerms) return false;
      return (rolePerms as Record<string, boolean>)[permission] === true;
    },
    [profile?.role, permissions]
  );

  const filteredNavigation = useCallback((): NavGroup[] => {
    const role = (profile?.role ?? "operator") as RoleKey;
    const rolePerms = permissions[role];
    if (!rolePerms || navigation.length === 0) return navigation;

    return navigation
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (!item.permission) return true;
          return (rolePerms as Record<string, boolean>)[item.permission] === true;
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [navigation, permissions, profile?.role]);

  const value: AdminConfigState = {
    navigation,
    permissions,
    loading,
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
