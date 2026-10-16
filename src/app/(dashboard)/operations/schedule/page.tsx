"use client";

import { PageTransition } from "@/components/layout/page-transition";
import { PipelineScheduleMiniCalendar } from "@/components/quotes/pipeline-schedule-mini-calendar";

/**
 * Full-bleed calendar. The page title sat above it saying "Schedule" on a tab
 * already called Schedule, and cost the calendar a row of height on every
 * screen. The calendar carries its own period controls, so it is the page.
 */
export default function OperationsSchedulePage() {
  return (
    <PageTransition className="flex min-h-0 w-full flex-1 flex-col h-[calc(100dvh-106px)] max-h-[calc(100dvh-106px)] lg:h-[calc(100dvh-106px)] lg:max-h-[calc(100dvh-106px)] overflow-hidden">
      <PipelineScheduleMiniCalendar hideCardTitle className="min-h-0 w-full flex-1" />
    </PageTransition>
  );
}
