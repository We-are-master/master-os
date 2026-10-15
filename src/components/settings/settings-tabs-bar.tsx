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
  { id: "ai-briefs", label: "AI & briefs", hint: "Configure AI settings and scheduled daily summaries." },
  { id: "setup", label: "Business settings", hint: "Configure operating rules, finance defaults and document requirements.", count: SETUP_TAB_BADGE_COUNT },
  { id: "agents", label: "AI agents", hint: "Manage AI agents and the guidance used in their conversations." },
  { id: "services", label: "Pricing", hint: "Manage service prices, labour rates, material costs and quote calculations." },
  { id: "lead-origins", label: "Lead sources", hint: "Manage the sources used to classify incoming leads." },
  { id: "navigation", label: "Navigation", hint: "Configure menu labels, destinations and visibility." },
  { id: "permissions", label: "Permissions", hint: "Define the access and actions available to each role." },
  { id: "team", label: "Users", hint: "Manage user accounts, invitations and access roles." },
  { id: "system", label: "System", hint: "Configure company information, integrations and system preferences." },
] as const;

/** Abas que são páginas próprias. */
export const SETTINGS_PAGE_TABS: Record<string, string> = { agents: "/agents", services: "/services" };

export function useSettingsTabs(): { id: string; label: string; hint?: string; count?: number }[] {
  const { profile } = useProfile();
  const { can } = useAdminConfig();
  const isAdmin = profile?.role === "admin";
  return useMemo(() => {
    const tabs: { id: string; label: string; hint?: string; count?: number }[] = [{ id: "profile", label: "Profile", hint: "Update your personal details and account preferences." }];
    for (const t of ADMIN_TABS) {
      // Quem já via Agents/Services pela lateral continua vendo pela aba.
      const allowed =
        isAdmin ||
        (t.id === "agents" && can("dashboard")) ||
        (t.id === "services" && can("service_catalog"));
      if (allowed) tabs.push({ id: t.id, label: t.label, hint: t.hint, count: "count" in t ? t.count : undefined });
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
