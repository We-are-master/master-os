"use client";

import { useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { SidebarContext } from "@/hooks/use-sidebar";
import { ProfileContext, useProfileLoader } from "@/hooks/use-profile";
import { ThemeContext, useThemeProvider } from "@/hooks/use-theme";
import { AdminConfigProvider } from "@/hooks/use-admin-config";
import { DuplicateConfirmProvider } from "@/contexts/duplicate-confirm-context";
import { ForcePasswordChangeModal } from "@/components/layout/force-password-change-modal";
import { ForceWorkforceRefresh } from "@/components/layout/force-workforce-refresh";

const MasterBrainAssistant = dynamic(
  () =>
    import("@/components/layout/master-brain-assistant").then((m) => ({
      default: m.MasterBrainAssistant,
    })),
  { ssr: false },
);

export default function DashboardLayoutClient({
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
                  className={cn(
                    "ml-0 flex min-w-0 flex-col h-screen overflow-x-hidden transition-[margin-left] duration-300 ease-in-out",
                    collapsed ? "lg:ml-[72px]" : "lg:ml-64",
                  )}
                >
                  <Header />
                  <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto p-4 sm:p-6 lg:p-8">
                    {children}
                  </main>
                  <MasterBrainAssistant />
                </div>
              </div>
              <ForcePasswordChangeModal />
              <ForceWorkforceRefresh />
            </DuplicateConfirmProvider>
          </AdminConfigProvider>
        </ProfileContext.Provider>
      </SidebarContext.Provider>
    </ThemeContext.Provider>
  );
}
