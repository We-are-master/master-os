import DashboardLayoutClient from "@/components/layout/dashboard-layout-client";
import { enforceSessionRefresh } from "@/components/layout/force-session-refresh";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await enforceSessionRefresh();
  return <DashboardLayoutClient>{children}</DashboardLayoutClient>;
}
