"use client";

import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { DailyOperationsTable, useDailyOperations } from "@/components/dashboard/daily-operations";

/**
 * Finance Dashboard — finance-level operational view.
 * Hosts the full Daily Operations table (Mon–Sat across the current month)
 * with the month-total summary rendered on top for quick reading.
 */
export default function FinanceDashboardPage() {
  const dailyOps = useDailyOperations();
  return (
    <PageTransition>
      <div className="space-y-4 px-1 sm:px-0">
        <PageHeader
          title="Finance Dashboard"
          subtitle="Daily operations — revenue, service cost, overhead share and margin per working day"
        />
        <DailyOperationsTable data={dailyOps} summaryPlacement="top" />
      </div>
    </PageTransition>
  );
}
