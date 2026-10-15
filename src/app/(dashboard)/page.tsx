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
import { PulseStrip } from "@/components/pulse/pulse-strip";

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
              <MonthGoal />
              {/* Faixas (15/10/2026): cada grupo de números numa peça só, com divisórias, em vez de 16 cartões soltos. */}
              <PulseStrip title="Operations" hint="Jobs right now, by stage.">
                <LiveOperations />
              </PulseStrip>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.35fr_1fr]">
                <PulseStrip title="This month" hint="Revenue, costs and margin for the selected period.">
                  <Financials />
                </PulseStrip>
                <PulseStrip title="To receive" hint="Unpaid invoices: what is open, what is overdue and what platforms pay on their own cycle.">
                  <MoneyReceivable />
                </PulseStrip>
              </div>
              <MonthFunnel />
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
