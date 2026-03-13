"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { DashboardView } from "@/types/dashboard-config";
import { getDashboardViews, saveDashboardView, deleteDashboardView, setDefaultView } from "@/services/dashboard-config";
import { useProfile } from "@/hooks/use-profile";
import type { RoleKey } from "@/types/admin-config";

interface DashboardConfigContext {
  views: DashboardView[];
  loading: boolean;
  canEdit: boolean;
  /** views the current user's role can see */
  visibleViews: DashboardView[];
  refresh: () => Promise<void>;
  saveView: (view: Omit<DashboardView, "created_at" | "updated_at">) => Promise<void>;
  deleteView: (id: string) => Promise<void>;
  makeDefault: (id: string) => Promise<void>;
}

const Ctx = createContext<DashboardConfigContext | null>(null);

export function DashboardConfigProvider({ children }: { children: React.ReactNode }) {
  const [views, setViews] = useState<DashboardView[]>([]);
  const [loading, setLoading] = useState(true);
  const { profile } = useProfile();

  const role = (profile?.role as RoleKey) ?? "operator";
  const canEdit = profile?.role === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getDashboardViews();
      setViews(data);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visibleViews = views.filter((v) => v.permissions.includes(role));

  const saveView = async (view: Omit<DashboardView, "created_at" | "updated_at">) => {
    if (!canEdit) throw new Error("Only Admin can change views.");
    const saved = await saveDashboardView(view);
    setViews((prev) => {
      const idx = prev.findIndex((v) => v.id === saved.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
      return [...prev, saved].sort((a, b) => a.sort_order - b.sort_order);
    });
  };

  const deleteView = async (id: string) => {
    if (!canEdit) throw new Error("Only Admin can delete views.");
    await deleteDashboardView(id);
    setViews((prev) => prev.filter((v) => v.id !== id));
  };

  const makeDefault = async (id: string) => {
    if (!canEdit) throw new Error("Only Admin can set the default view.");
    await setDefaultView(id);
    setViews((prev) => prev.map((v) => ({ ...v, is_default: v.id === id })));
  };

  return (
    <Ctx.Provider value={{ views, loading, canEdit, visibleViews, refresh: load, saveView, deleteView, makeDefault }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDashboardConfig() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDashboardConfig must be inside DashboardConfigProvider");
  return ctx;
}
