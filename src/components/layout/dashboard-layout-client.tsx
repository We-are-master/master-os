"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
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
import { SemAcessoAoOs } from "@/components/layout/sem-acesso-ao-os";

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
  // A /inbox ocupa a tela toda, como o Atendimento do VOS: sem cabeçalho nem margem.
  const telaCheia = usePathname()?.startsWith("/inbox") ?? false;
  // Na /inbox o menu começa fechado (só ícones, com o botão de expandir); fora dela, volta aberto.
  useEffect(() => {
    setCollapsed(telaCheia);
  }, [telaCheia]);

  const toggle = useCallback(() => setCollapsed((p) => !p), []);
  const toggleMobile = useCallback(() => setMobileOpen((p) => !p), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const sidebarValue = useMemo(
    () => ({ collapsed, mobileOpen, toggle, toggleMobile, closeMobile }),
    [collapsed, mobileOpen, toggle, toggleMobile, closeMobile],
  );

  if (!profileState.loading && profileState.blocked) return <SemAcessoAoOs />;

  return (
    <ThemeContext.Provider value={themeState}>
      <SidebarContext.Provider value={sidebarValue}>
        <ProfileContext.Provider value={profileState}>
          <AdminConfigProvider>
            <DuplicateConfirmProvider>
              <div className="min-h-screen bg-[var(--bg)]">
                <Sidebar />
                <div
                  className={cn(
                    // --inbox-lateral: largura do Inbox lateral aberto; a página encolhe em vez de ficar por baixo.
                    "ml-0 flex min-w-0 flex-col h-screen overflow-x-hidden transition-[margin-left,margin-right] duration-300 ease-in-out lg:mr-[var(--inbox-lateral,0px)]",
                    collapsed ? "lg:ml-[66px]" : "lg:ml-[216px]",
                  )}
                >
                  {telaCheia ? null : <Header />}
                  <main
                    className={cn(
                      "flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto",
                      telaCheia ? "p-0" : "px-[14px] pt-5 pb-24 sm:px-6 sm:pb-14",
                    )}
                  >
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
