"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs } from "@/components/ui/tabs";
import { useProfile } from "@/hooks/use-profile";
import { useAdminConfig } from "@/hooks/use-admin-config";
import { SETUP_TAB_BADGE_COUNT } from "@/lib/settings-setup-sections";

/**
 * Abas do Settings. Agents e Services moram nas páginas deles (/agents é
 * renderizada no servidor), mas aparecem aqui como abas e saem da lateral.
 */
const ADMIN_TABS = [
  { id: "ai-briefs", label: "AI & Daily brief" },
  { id: "setup", label: "Setup", count: SETUP_TAB_BADGE_COUNT },
  { id: "agents", label: "Agents" },
  { id: "services", label: "Services" },
  { id: "lead-origins", label: "Lead origins" },
  { id: "navigation", label: "Navigation" },
  { id: "permissions", label: "Roles & permissions" },
  { id: "team", label: "Users access" },
  { id: "system", label: "System" },
] as const;

/** Abas que são páginas próprias. */
export const SETTINGS_PAGE_TABS: Record<string, string> = { agents: "/agents", services: "/services" };

export function useSettingsTabs(): { id: string; label: string; count?: number }[] {
  const { profile } = useProfile();
  const { can } = useAdminConfig();
  const isAdmin = profile?.role === "admin";
  return useMemo(() => {
    const tabs: { id: string; label: string; count?: number }[] = [{ id: "profile", label: "My profile" }];
    for (const t of ADMIN_TABS) {
      // Quem já via Agents/Services pela lateral continua vendo pela aba.
      const allowed =
        isAdmin ||
        (t.id === "agents" && can("dashboard")) ||
        (t.id === "services" && can("service_catalog"));
      if (allowed) tabs.push({ id: t.id, label: t.label, count: "count" in t ? t.count : undefined });
    }
    return tabs;
  }, [isAdmin, can]);
}

export function settingsTabHref(id: string): string {
  return SETTINGS_PAGE_TABS[id] ?? (id === "profile" ? "/settings" : `/settings?tab=${id}`);
}

/** Topo do Settings para as abas que são páginas próprias (Agents, Services). */
export function SettingsTabsBar({ active }: { active: string }) {
  const router = useRouter();
  const tabs = useSettingsTabs();
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />
      <Tabs tabs={tabs} activeTab={active} onChange={(id) => router.push(settingsTabHref(id))} />
    </div>
  );
}
