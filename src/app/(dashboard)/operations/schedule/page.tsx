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
    <PageTransition className="flex min-h-0 w-full flex-1 flex-col -mt-2 sm:-mt-3 lg:-mt-4 h-[calc(100dvh-6rem)] max-h-[calc(100dvh-6rem)] lg:h-[calc(100dvh-7rem)] lg:max-h-[calc(100dvh-7rem)] overflow-hidden">
      <PipelineScheduleMiniCalendar hideCardTitle className="min-h-0 w-full flex-1" />
    </PageTransition>
  );
}
