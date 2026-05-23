"use client";

import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { PipelineScheduleMiniCalendar } from "@/components/quotes/pipeline-schedule-mini-calendar";

export default function OperationsSchedulePage() {
  return (
    <PageTransition className="flex min-h-0 w-full flex-1 flex-col">
      <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
        <PageHeader
          title="Schedule"
          infoTooltip={
            "Calendar of active pipeline jobs (action required through final checks): year, month, week, or day. For the live partner map use Overview → Live View."
          }
        />
        <PipelineScheduleMiniCalendar hideCardTitle className="min-h-0 w-full flex-1" />
      </div>
    </PageTransition>
  );
}
