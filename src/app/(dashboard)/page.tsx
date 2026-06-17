"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import "@/styles/pulse-dark.css";
import { PageTransition } from "@/components/layout/page-transition";
import { DashboardDateRangeProvider } from "@/hooks/use-dashboard-date-range";
import { useProfile } from "@/hooks/use-profile";
import { isCeoDashboardAllowedUser } from "@/lib/ceo-dashboard-access";
import { PulseHead } from "@/components/pulse/pulse-head";
import { LiveOperations } from "@/components/pulse/live-operations";
import { Financials } from "@/components/pulse/financials";
import { TodaysFlow } from "@/components/pulse/todays-flow";
import { AlertsFeed } from "@/components/pulse/alerts-feed";
import { LiveBoard } from "@/components/pulse/live-board";
import { RevenueTrend } from "@/components/pulse/revenue-trend";
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
      <div className="pulse-dark">
        <div className="space-y-6">
          <PulseHead
            firstName={firstName}
            ceoMode={ceoMode}
            canSeeCeo={canSeeCeoDashboard}
            onToggleCeo={setCeoModeUser}
          />
          {ceoMode ? (
            <CeoFinancialDashboard />
          ) : (
            <>
              <LiveOperations />
              <Financials />
              <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4 lg:items-start">
                <TodaysFlow />
                <AlertsFeed />
              </div>
              <LiveBoard />
              <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 items-stretch">
                <RevenueTrend />
                <TopAccounts />
              </div>
            </>
          )}
        </div>
      </div>
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
