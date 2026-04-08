"use client";

import { useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { SidebarContext } from "@/hooks/use-sidebar";
import { ProfileContext, useProfileLoader } from "@/hooks/use-profile";
import { ThemeContext, useThemeProvider } from "@/hooks/use-theme";
import { AdminConfigProvider } from "@/hooks/use-admin-config";
import { DuplicateConfirmProvider } from "@/contexts/duplicate-confirm-context";

// AI assistant is not critical-path — lazy-loaded so it doesn't bloat the
// initial dashboard bundle and doesn't block navigation.
const MasterBrainAssistant = dynamic(
  () =>
    import("@/components/layout/master-brain-assistant").then((m) => ({
      default: m.MasterBrainAssistant,
    })),
  { ssr: false },
);

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const profileState = useProfileLoader();
  const themeState = useThemeProvider();

  const toggle = useCallback(() => setCollapsed((p) => !p), []);
  const toggleMobile = useCallback(() => setMobileOpen((p) => !p), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  // Stable reference so SidebarContext consumers don't re-render on every
  // parent render (profileState/themeState object churn cascaded before).
  const sidebarValue = useMemo(
    () => ({ collapsed, mobileOpen, toggle, toggleMobile, closeMobile }),
    [collapsed, mobileOpen, toggle, toggleMobile, closeMobile],
  );

  return (
    <ThemeContext.Provider value={themeState}>
      <SidebarContext.Provider value={sidebarValue}>
        <ProfileContext.Provider value={profileState}>
          <AdminConfigProvider>
          <DuplicateConfirmProvider>
          <div className="min-h-screen bg-surface-secondary">
            <Sidebar />
            <div
              style={{ marginLeft: collapsed ? 72 : 256 }}
              className="flex flex-col h-screen transition-[margin-left] duration-300 ease-in-out"
            >
              <Header />
              <main className="flex-1 overflow-y-auto p-6 lg:p-8">
                {children}
              </main>
              <MasterBrainAssistant />
            </div>
          </div>
          </DuplicateConfirmProvider>
          </AdminConfigProvider>
        </ProfileContext.Provider>
      </SidebarContext.Provider>
    </ThemeContext.Provider>
  );
}
