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
import { LiveOperations } from "@/components/pulse/live-operations";
import { MonthGoal } from "@/components/pulse/month-goal";
import { PulseCeoProvider } from "@/components/pulse/pulse-ceo-data";
import { MonthFunnel } from "@/components/pulse/month-funnel";
import { MoneyReceivable } from "@/components/pulse/money-receivable";
import { MonthBurnUp, RevenueBySource } from "@/components/pulse/month-charts";
import { Financials } from "@/components/pulse/financials";
import { TodaysFlow } from "@/components/pulse/todays-flow";
import { AlertsFeed } from "@/components/pulse/alerts-feed";
import { LiveBoard } from "@/components/pulse/live-board";
import { TopAccounts } from "@/components/pulse/top-accounts";

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
      <div className="pulse-dark">
        {/* Colado no header e mais denso (dono, 12/10/2026), mesmo recuo da tela de Leads. */}
        <div className="-mt-2 space-y-4 sm:-mt-3 lg:-mt-4">
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
              <MonthGoal />
              <LiveOperations />
              <MonthFunnel />
              <Financials />
              <MoneyReceivable />
              <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4 lg:items-start">
                <TodaysFlow />
                <AlertsFeed />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 items-stretch">
                <MonthBurnUp />
                <RevenueBySource />
              </div>
              {/* Live Jobs e as maiores contas do ano, meia tela cada (dono, 12/10/2026). O Auto-flow saiu. */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch [&>*]:min-w-0">
                <LiveBoard />
                <TopAccounts />
              </div>
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
