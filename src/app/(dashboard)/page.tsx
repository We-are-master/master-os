"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import "@/styles/pulse-dark.css";
import { PageTransition } from "@/components/layout/page-transition";
import { DashboardDateRangeProvider } from "@/hooks/use-dashboard-date-range";
import { useProfile } from "@/hooks/use-profile";
import { isCeoDashboardAllowedUser } from "@/lib/ceo-dashboard-access";
import { PulseHead } from "@/components/pulse/pulse-head";
import { PulseCurrencyProvider } from "@/lib/pulse-currency";
import { MonthHealth } from "@/components/pulse/month-health";
import { NeedsYouToday } from "@/components/pulse/needs-you-today";
import { PulseCeoProvider } from "@/components/pulse/pulse-ceo-data";
import { MonthFunnel } from "@/components/pulse/month-funnel";
import { MonthBurnUp } from "@/components/pulse/month-charts";
import { RevenueMix } from "@/components/pulse/revenue-mix";
import { TodaysFlow } from "@/components/pulse/todays-flow";
import { AlertsFeed } from "@/components/pulse/alerts-feed";
import { LiveBoard } from "@/components/pulse/live-board";

const CeoFinancialDashboard = dynamic(
  () =>
    import("@/components/dashboard/ceo-financial-dashboard").then((m) => ({
      default: m.CeoFinancialDashboard,
    })),
  { ssr: false, loading: () => <div className="h-96 animate-pulse rounded-xl bg-fx-paper-2/40" /> },
);

function PulseInner() {
  const { profile } = useProfile();
  const firstName = profile?.full_name?.split(" ")[0] || "there";
  const canSeeCeoDashboard = useMemo(() => isCeoDashboardAllowedUser(profile), [profile]);
  const [ceoModeUser, setCeoModeUser] = useState(false);
  const ceoMode = ceoModeUser && canSeeCeoDashboard;

  return (
    <PageTransition>
      <PulseCurrencyProvider>
      {/* Container (03/11/2026): as grades olham a largura do painel, não da tela. Com o Inbox lateral
          aberto a página encolhe ~520px, e os breakpoints de tela (lg/xl) mantinham 5-6 colunas apertadas. */}
      <div className="pulse-dark @container">
        {/* Mesmo respiro das outras telas (15/10/2026): a margem negativa colava o título na busca. */}
        <div className="space-y-3">
          <PulseHead
            firstName={firstName}
            ceoMode={ceoMode}
            canSeeCeo={canSeeCeoDashboard}
            onToggleCeo={setCeoModeUser}
          />
          {ceoMode ? (
            <CeoFinancialDashboard />
          ) : (
            <PulseCeoProvider>
              {/* Saúde num olhar (dono, 05/11/2026): frase do mês + Sales, Profit e Cash com semáforo.
                  Substitui a meta, a faixa de operação e as faixas de resultado e a receber. */}
              <MonthHealth />
              <MonthFunnel />
              <NeedsYouToday />
              <div className="grid grid-cols-1 @3xl:grid-cols-[1.6fr_1fr] gap-4 @3xl:items-start">
                <TodaysFlow />
                <AlertsFeed />
              </div>
              <div className="grid grid-cols-1 @3xl:grid-cols-[1.4fr_1fr] gap-4 items-stretch">
                <MonthBurnUp />
                {/* Canal e maiores contas num card só, no mesmo período (05/11/2026). */}
                <RevenueMix />
              </div>
              {/* Live Jobs na largura toda (05/11/2026): as maiores contas foram para o card de receita. */}
              <LiveBoard />
            </PulseCeoProvider>
          )}
        </div>
      </div>
      </PulseCurrencyProvider>
    </PageTransition>
  );
}

export default function PulsePage() {
  return (
    <DashboardDateRangeProvider>
      <PulseInner />
    </DashboardDateRangeProvider>
  );
}
