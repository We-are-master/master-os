"use client";

import dynamic from "next/dynamic";
import type { WidgetConfig, WidgetSize } from "@/types/dashboard-config";
import { cn } from "@/lib/utils";

// Light widgets (no recharts) — load eagerly.
import { StatsGrid } from "./stats-grid";
import { PartnerMarginTop5, PartnerPayoutTop5 } from "./partner-financial-top5";
import { PipelineSummary } from "./pipeline-summary";
import { PriorityTasks } from "./priority-tasks";
import { ActivityFeed } from "./activity-feed";
import { QuickActions } from "./quick-actions";
import { FinancialSnapshot } from "./financial-snapshot";

// Heavy widgets (recharts / d3) — lazy-loaded. Each is code-split into its
// own chunk and only downloaded when actually rendered. This removes
// ~200-300 KB from the initial dashboard bundle.
const chartSkeleton = () => (
  <div className="h-64 w-full animate-pulse bg-surface-tertiary rounded-xl" />
);
const RevenueChart = dynamic(
  () => import("./revenue-chart").then((m) => ({ default: m.RevenueChart })),
  { ssr: false, loading: chartSkeleton },
);
const QuoteFunnel = dynamic(
  () => import("./quote-funnel").then((m) => ({ default: m.QuoteFunnel })),
  { ssr: false, loading: chartSkeleton },
);
const JobsStatusDonut = dynamic(
  () => import("./jobs-status-donut").then((m) => ({ default: m.JobsStatusDonut })),
  { ssr: false, loading: chartSkeleton },
);
const PartnersByTradeChart = dynamic(
  () => import("./partners-by-trade-chart").then((m) => ({ default: m.PartnersByTradeChart })),
  { ssr: false, loading: chartSkeleton },
);
const MarginChart = dynamic(
  () => import("./margin-chart").then((m) => ({ default: m.MarginChart })),
  { ssr: false, loading: chartSkeleton },
);
const PartnerPerformance = dynamic(
  () => import("./partner-performance").then((m) => ({ default: m.PartnerPerformance })),
  { ssr: false, loading: chartSkeleton },
);
const FinanceFlow = dynamic(
  () => import("./finance-flow").then((m) => ({ default: m.FinanceFlow })),
  { ssr: false, loading: chartSkeleton },
);
const CustomMetricWidget = dynamic(
  () => import("./custom-widgets").then((m) => ({ default: m.CustomMetricWidget })),
  { ssr: false, loading: chartSkeleton },
);
const CustomChartWidget = dynamic(
  () => import("./custom-widgets").then((m) => ({ default: m.CustomChartWidget })),
  { ssr: false, loading: chartSkeleton },
);
const CustomTableWidget = dynamic(
  () => import("./custom-widgets").then((m) => ({ default: m.CustomTableWidget })),
  { ssr: false, loading: chartSkeleton },
);

const SIZE_CLASS: Record<WidgetSize, string> = {
  one_third:  "col-span-1",
  half:       "col-span-1 lg:col-span-1",  // handled in grid
  two_thirds: "col-span-1 lg:col-span-2",
  full:       "col-span-full",
};

// We render all widgets in a 3-column grid.
// one_third = 1 col, half = depends (we use 1.5 but achieve with pair), two_thirds = 2 cols, full = 3 cols
const GRID_SPAN: Record<WidgetSize, string> = {
  one_third:  "col-span-3 md:col-span-1",
  half:       "col-span-3 md:col-span-1 lg:col-span-1",  // we pair them externally
  two_thirds: "col-span-3 md:col-span-2",
  full:       "col-span-3",
};

export function getWidgetColSpan(size: WidgetSize): string {
  return GRID_SPAN[size];
}

interface WidgetRendererProps {
  widget: WidgetConfig;
  className?: string;
}

export function WidgetRenderer({ widget, className }: WidgetRendererProps) {
  const cls = cn("h-full", className);
  switch (widget.type) {
    case "stats_grid":          return <div className={cls}><StatsGrid /></div>;
    case "revenue_chart":       return <div className={cls}><RevenueChart /></div>;
    case "quote_funnel":        return <div className={cls}><QuoteFunnel /></div>;
    case "jobs_status_donut":   return <div className={cls}><JobsStatusDonut /></div>;
    case "partners_by_trade":   return <div className={cls}><PartnersByTradeChart compact /></div>;
    case "margin_chart":        return <div className={cls}><MarginChart /></div>;
    case "partner_performance": return <div className={cls}><PartnerPerformance /></div>;
    case "partner_payout_top5": return <div className={cls}><PartnerPayoutTop5 /></div>;
    case "partner_margin_top5": return <div className={cls}><PartnerMarginTop5 /></div>;
    case "finance_flow":        return <div className={cls}><FinanceFlow /></div>;
    case "financial_snapshot":  return <div className={cls}><FinancialSnapshot /></div>;
    case "pipeline_summary":    return <div className={cls}><PipelineSummary /></div>;
    case "priority_tasks":      return <div className={cls}><PriorityTasks /></div>;
    case "activity_feed":       return <div className={cls}><ActivityFeed /></div>;
    case "quick_actions":       return <div className={cls}><QuickActions /></div>;
    case "custom_metric":       return <div className={cls}><CustomMetricWidget widget={widget} /></div>;
    case "custom_chart":        return <div className={cls}><CustomChartWidget widget={widget} /></div>;
    case "custom_table":        return <div className={cls}><CustomTableWidget widget={widget} /></div>;
    default:                    return <div className={cn("rounded-xl border border-dashed border-border p-6 flex items-center justify-center", cls)}>
      <p className="text-sm text-text-tertiary">Unknown widget: {widget.type}</p>
    </div>;
  }
}
