"use client";

import { useState, useCallback } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { SidebarContext } from "@/hooks/use-sidebar";
import { ProfileContext, useProfileLoader } from "@/hooks/use-profile";
import { ThemeContext, useThemeProvider } from "@/hooks/use-theme";
import { AdminConfigProvider } from "@/hooks/use-admin-config";
import { motion } from "framer-motion";

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

  return (
    <ThemeContext.Provider value={themeState}>
      <SidebarContext.Provider
        value={{ collapsed, mobileOpen, toggle, toggleMobile, closeMobile }}
      >
        <ProfileContext.Provider value={profileState}>
          <AdminConfigProvider>
          <div className="min-h-screen bg-surface-secondary">
            <Sidebar />
            <motion.div
              initial={false}
              animate={{ marginLeft: collapsed ? 72 : 256 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="flex flex-col h-screen"
            >
              <Header />
              <main className="flex-1 overflow-y-auto p-6 lg:p-8">
                {children}
              </main>
            </motion.div>
          </div>
          </AdminConfigProvider>
        </ProfileContext.Provider>
      </SidebarContext.Provider>
    </ThemeContext.Provider>
  );
}
