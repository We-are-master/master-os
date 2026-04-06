"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { staggerItem } from "@/lib/motion";
import { useProfile } from "@/hooks/use-profile";
import { getSupabase } from "@/services/base";
import { DashboardConfigProvider, useDashboardConfig } from "@/hooks/use-dashboard-config";
import {
  DashboardDateRangeProvider,
  useDashboardDateRange,
} from "@/hooks/use-dashboard-date-range";
import { DashboardDateToolbar } from "@/components/dashboard/dashboard-date-toolbar";
import { WidgetRenderer } from "@/components/dashboard/widget-renderer";
import { DashboardViewEditor } from "@/components/dashboard/dashboard-view-editor";
import { OperationsStatus } from "@/components/dashboard/operations-status";
import { CeoFinancialDashboard } from "@/components/dashboard/ceo-financial-dashboard";
import type { DashboardView, WidgetConfig } from "@/types/dashboard-config";
import {
  LayoutDashboard, DollarSign, Briefcase, BarChart2, PieChart,
  Activity, Users, Settings, Layers, Plus, Pencil, SlidersHorizontal,
  ChevronDown, Crown, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { dashboardJobsFilterSelectColumns, isLegacyJobSchema } from "@/lib/job-schema-compat";
import { jobExecutionOverlapsYmdRange } from "@/lib/job-period-overlap";
import { isCeoDashboardAllowedUser } from "@/lib/ceo-dashboard-access";

// ─── Icon map ────────────────────────────────────────────────────────────────
const ICON_MAP: Record<string, React.ElementType> = {
  LayoutDashboard, DollarSign, Briefcase, BarChart2, PieChart,
  Activity, Users, Settings, Layers,
};

type DashboardFilter =
  | "commission_pending" | "financial_status" | "awaiting_payment"
  | "without_invoice" | "without_selfbill" | "without_report"
  | "without_partner" | "without_quote" | "low_margin";

const FILTER_CHIPS: { id: DashboardFilter; label: string; color: string }[] = [
  { id: "commission_pending", label: "Commission Pending",  color: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100" },
  { id: "awaiting_payment",   label: "Awaiting Payment",   color: "bg-red-50 text-red-700 border-red-200 hover:bg-red-100" },
  { id: "without_invoice",    label: "Without Invoice",    color: "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100" },
  { id: "without_selfbill",   label: "Without Self Billing", color: "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100" },
  { id: "without_report",     label: "Without Report",     color: "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100" },
  { id: "without_partner",    label: "Without Partner",    color: "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100" },
  { id: "without_quote",      label: "Without Quote",      color: "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100" },
  { id: "low_margin",         label: "Low Margin (<20%)",  color: "bg-red-50 text-red-700 border-red-200 hover:bg-red-100" },
  { id: "financial_status",   label: "Finance Unpaid",     color: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100" },
];

// ─── Grid layout helpers ──────────────────────────────────────────────────────
function getColSpanClass(size: WidgetConfig["size"]): string {
  switch (size) {
    case "full":       return "col-span-12";
    case "two_thirds": return "col-span-12 lg:col-span-8";
    case "half":       return "col-span-12 md:col-span-6";
    case "one_third":  return "col-span-12 md:col-span-6 lg:col-span-4";
  }
}

const PIPELINE_ROW_WIDGETS = new Set<WidgetConfig["type"]>([
  "pipeline_summary",
  "partner_payout_top5",
  "partner_margin_top5",
]);

/** Revenue Overview always uses the full 12-column row (not split with Quick Actions, etc.). */
function getWidgetGridClass(widget: WidgetConfig, orderedWidgets: WidgetConfig[], activeView: DashboardView | null): string {
  if (widget.type === "revenue_chart") return "col-span-12";
  /** Overview: Jobs donut + Request→Job funnel + Partners by trade share one row (3×4 cols from `md`). */
  if (
    activeView &&
    isOverviewView(activeView) &&
    (widget.type === "jobs_status_donut" || widget.type === "quote_funnel" || widget.type === "partners_by_trade")
  ) {
    return "col-span-12 md:col-span-4";
  }
  /** If only one Top 5 companion exists, let Pipeline expand to avoid empty space. */
  if (widget.type === "pipeline_summary") {
    const companionCount = orderedWidgets.filter(
      (w) => w.type === "partner_payout_top5" || w.type === "partner_margin_top5"
    ).length;
    if (companionCount <= 1) return getColSpanClass("two_thirds");
    return getColSpanClass("one_third");
  }
  /** Partner Top 5 cards stay one-third and pair nicely with expanded Pipeline. */
  if (widget.type === "partner_payout_top5" || widget.type === "partner_margin_top5") {
    return getColSpanClass("one_third");
  }
  if (PIPELINE_ROW_WIDGETS.has(widget.type)) return getColSpanClass("one_third");
  return getColSpanClass(widget.size);
}

/** Removed from dashboard grid entirely. */
const DASHBOARD_HIDDEN_WIDGET_TYPES = new Set<WidgetConfig["type"]>(["activity_feed", "quick_actions"]);

/** Hidden on the Overview tab only (other views keep full widget set). */
const OVERVIEW_HIDDEN_WIDGET_TYPES = new Set<WidgetConfig["type"]>([
  "priority_tasks",
  "custom_chart",
  "revenue_chart",
  "margin_chart",
  "pipeline_summary",
  "partner_payout_top5",
  "partner_margin_top5",
  "partner_performance",
  "finance_flow",
]);

function isOverviewView(view: DashboardView | null): boolean {
  return (view?.name?.trim().toLowerCase() ?? "") === "overview";
}

function isOperationsView(view: DashboardView | null): boolean {
  return (view?.name?.trim().toLowerCase() ?? "") === "operations";
}

function isCashFlowOrTopPartners(w: WidgetConfig): boolean {
  return w.type === "finance_flow" || w.type === "partner_performance";
}

/**
 * Renders Cash Flow + Top Partners directly above the first Jobs by Status widget,
 * preserving their relative order and leaving other widgets in position order.
 */
function orderCashFlowPartnersAboveJobsDonut(widgets: WidgetConfig[]): WidgetConfig[] {
  const byPos = [...widgets].sort((a, b) => a.position - b.position);
  const fp = byPos.filter(isCashFlowOrTopPartners);
  if (fp.length === 0 || !byPos.some((w) => w.type === "jobs_status_donut")) {
    return byPos;
  }
  const withoutFp = byPos.filter((w) => !isCashFlowOrTopPartners(w));
  const firstDonutIdx = withoutFp.findIndex((w) => w.type === "jobs_status_donut");
  if (firstDonutIdx === -1) return byPos;
  return [...withoutFp.slice(0, firstDonutIdx), ...fp, ...withoutFp.slice(firstDonutIdx)];
}

/**
 * Overview: place **Partners by type of work** in the same row as Jobs donut + Quote funnel (1/3 width each).
 */
function injectOverviewPartnersWidget(widgets: WidgetConfig[], activeView: DashboardView | null): WidgetConfig[] {
  if (!activeView || !isOverviewView(activeView)) return widgets;
  if (widgets.some((w) => w.type === "partners_by_trade")) return widgets;
  const sorted = [...widgets].sort((a, b) => a.position - b.position);
  const funnelIdx = sorted.findIndex((w) => w.type === "quote_funnel");
  const insert: WidgetConfig = {
    id: "overview-partners-by-trade",
    type: "partners_by_trade",
    title: "Partners by type of work",
    size: "one_third",
    position: 0,
  };
  if (funnelIdx === -1) {
    const next = [...sorted, insert];
    return next.map((w, i) => ({ ...w, position: i }));
  }
  const next = [...sorted];
  next.splice(funnelIdx + 1, 0, insert);
  return next.map((w, i) => ({ ...w, position: i }));
}

// ─── Dashboard inner (needs context) ─────────────────────────────────────────
function DashboardInner() {
  const { profile } = useProfile();
  const firstName = profile?.full_name?.split(" ")[0] || "there";
  const { visibleViews, loading: viewsLoading, canEdit } = useDashboardConfig();
  const { bounds, rangeLabel } = useDashboardDateRange();

  const [activeFilters, setActiveFilters] = useState<Set<DashboardFilter>>(new Set());
  const [filterCounts, setFilterCounts] = useState<Record<string, number>>({});
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingView, setEditingView] = useState<DashboardView | null>(null);
  const [ceoDashboard, setCeoDashboard] = useState(false);
  /** Bump to remount widgets and pull fresh data. */
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);

  const canSeeCeoDashboard = useMemo(() => isCeoDashboardAllowedUser(profile), [profile]);

  useEffect(() => {
    if (!canSeeCeoDashboard && ceoDashboard) setCeoDashboard(false);
  }, [canSeeCeoDashboard, ceoDashboard]);

  // Set default view when views load
  useEffect(() => {
    if (visibleViews.length === 0 || activeViewId) return;
    const def = visibleViews.find((v) => v.is_default) ?? visibleViews[0];
    queueMicrotask(() => setActiveViewId(def.id));
  }, [visibleViews, activeViewId]);

  const activeView = useMemo(
    () => visibleViews.find((v) => v.id === activeViewId) ?? null,
    [visibleViews, activeViewId]
  );

  const toggleFilter = (id: DashboardFilter) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const loadFilterCounts = useCallback(async () => {
    const supabase = getSupabase();
    try {
      const col = dashboardJobsFilterSelectColumns({ periodOverlap: Boolean(bounds) });
      const CHUNK = 600;
      let jobs: {
        id: string;
        reference?: string;
        status: string;
        partner_id?: string;
        partner_name?: string;
        quote_id?: string;
        margin_percent: number;
        finance_status?: string;
        report_submitted?: boolean;
        commission?: number;
      }[] = [];

      if (bounds) {
        const fromD = bounds.fromIso.slice(0, 10);
        const toD = bounds.toIso.slice(0, 10);
        for (let off = 0; ; off += CHUNK) {
          const { data, error } = await supabase
            .from("jobs")
            .select(col)
            .is("deleted_at", null)
            .range(off, off + CHUNK - 1);
          if (error) break;
          const batch = (data ?? []) as unknown as typeof jobs;
          for (const j of batch) {
            if (jobExecutionOverlapsYmdRange(j, fromD, toD)) jobs.push(j);
          }
          if (batch.length < CHUNK) break;
        }
      } else {
        const { data } = await supabase.from("jobs").select(col).is("deleted_at", null);
        jobs = (data ?? []) as unknown as typeof jobs;
      }

      const { data: invData } = await supabase.from("invoices").select("id, job_reference");
      const invoiceRefs = new Set(
        (invData ?? []).map((i: { job_reference?: string }) => i.job_reference?.trim()).filter(Boolean) as string[],
      );
      setFilterCounts({
        commission_pending: jobs.filter((j) => (j.commission ?? 0) > 0 && j.finance_status !== "paid").length,
        awaiting_payment:   jobs.filter((j) => j.status === "awaiting_payment").length,
        without_invoice:    jobs.filter((j) => !invoiceRefs.has(j.reference ?? "") && j.status !== "completed").length,
        without_selfbill:   jobs.filter((j) => !!j.partner_name && j.status === "completed").length,
        without_report:     jobs.filter((j) => !j.report_submitted && !["completed", "scheduled"].includes(j.status)).length,
        without_partner:    jobs.filter((j) => !j.partner_id && !j.partner_name).length,
        without_quote:      isLegacyJobSchema() ? 0 : jobs.filter((j) => !j.quote_id).length,
        low_margin:         jobs.filter((j) => j.margin_percent < 20 && j.margin_percent > 0).length,
        financial_status:   jobs.filter((j) => j.finance_status !== "paid" && !["completed", "scheduled"].includes(j.status)).length,
      });
    } catch { /* non-critical */ }
  }, [bounds]);

  const refreshDashboard = useCallback(() => {
    setDashboardRefreshKey((k) => k + 1);
    void loadFilterCounts();
  }, [loadFilterCounts]);

  useEffect(() => {
    queueMicrotask(() => void loadFilterCounts());
  }, [loadFilterCounts]);

  const greeting = getGreeting();

  const openNewView = () => { setEditingView(null); setEditorOpen(true); };
  const openEditView = (view: DashboardView) => { setEditingView(view); setEditorOpen(true); };

  return (
    <PageTransition>
      <div className="space-y-5">
        {/* Header */}
        <PageHeader title={`${greeting}, ${firstName}`}>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={refreshDashboard}
              title="Refresh dashboard"
            >
              Refresh
            </Button>
            <Badge variant="success" dot pulse size="md">Live</Badge>
          </div>
        </PageHeader>

        {/* ── View picker ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          {canSeeCeoDashboard && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                setCeoDashboard(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setCeoDashboard(true);
                }
              }}
              className={cn(
                "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-medium border transition-all cursor-pointer select-none",
                ceoDashboard
                  ? "bg-emerald-700 text-white border-emerald-700 shadow-sm dark:bg-emerald-800 dark:border-emerald-800"
                  : "bg-card text-text-secondary border-border hover:bg-surface-hover"
              )}
            >
              <Crown className="h-3.5 w-3.5 flex-shrink-0" />
              CEO
            </div>
          )}
          {viewsLoading
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-8 w-24 animate-pulse rounded-xl bg-surface-hover" />
              ))
            : visibleViews.map((view) => {
                const IconComp = ICON_MAP[view.icon] ?? LayoutDashboard;
                const isActive = !ceoDashboard && view.id === activeViewId;
                return (
                  <div
                    key={view.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setCeoDashboard(false);
                      setActiveViewId(view.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setCeoDashboard(false);
                        setActiveViewId(view.id);
                      }
                    }}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-medium border transition-all cursor-pointer select-none",
                      isActive
                        ? "bg-primary text-white border-primary shadow-sm"
                        : "bg-card text-text-secondary border-border hover:bg-surface-hover"
                    )}
                  >
                    <IconComp className="h-3.5 w-3.5 flex-shrink-0" />
                    {view.name}
                    {view.is_default && !isActive && (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary/40" />
                    )}
                    {canEdit && isActive && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditView(view);
                        }}
                        className="ml-1 p-0.5 rounded hover:bg-white/20 transition-colors"
                        aria-label={`Edit view ${view.name}`}
                      >
                        <Pencil className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </div>
                );
              })
          }
          {canEdit && (
            <button
              onClick={openNewView}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-dashed border-border text-text-tertiary hover:border-primary hover:text-primary transition-all"
            >
              <Plus className="h-3.5 w-3.5" />
              New view
            </button>
          )}
        </div>

        {/* View description */}
        {activeView?.description && !ceoDashboard && (
          <p className="text-xs text-text-tertiary -mt-1">{activeView.description}</p>
        )}

        {(!isOperationsView(activeView) || ceoDashboard) && (
          <DashboardDateToolbar
            footnote={
              ceoDashboard ? (
                <>
                  CEO dashboard: <strong className="text-text-secondary">{rangeLabel}</strong>
                  <span className="block mt-1 text-text-tertiary">
                    Presets include today, week-to-date, month-to-date, quarter-to-date, year-to-date, and custom range
                  </span>
                </>
              ) : undefined
            }
            trailing={
              ceoDashboard ? null : (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setFilterMenuOpen((o) => !o)}
                  className={cn(
                    "inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium border transition-all",
                    activeFilters.size > 0
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border bg-card/80 text-text-secondary hover:bg-surface-hover",
                  )}
                  aria-expanded={filterMenuOpen}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Job filters
                  {activeFilters.size > 0 && (
                    <span className="text-xs font-semibold tabular-nums bg-primary/15 px-1.5 py-0.5 rounded-md">{activeFilters.size}</span>
                  )}
                  <ChevronDown className={cn("h-4 w-4 text-text-tertiary transition-transform", filterMenuOpen && "rotate-180")} />
                </button>
                {filterMenuOpen && (
                  <>
                    <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close filters" onClick={() => setFilterMenuOpen(false)} />
                    <div className="absolute right-0 top-full z-50 mt-1 w-[min(100vw-2rem,22rem)] rounded-xl border border-border-light bg-card shadow-lg py-2 max-h-[min(70vh,420px)] overflow-y-auto">
                      <div className="px-3 pb-2 flex items-center justify-between gap-2 border-b border-border-light mb-1">
                        <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Highlight jobs</span>
                        {activeFilters.size > 0 && (
                          <button
                            type="button"
                            onClick={() => setActiveFilters(new Set())}
                            className="text-[11px] font-medium text-primary hover:underline"
                          >
                            Clear all
                          </button>
                        )}
                      </div>
                      <div className="px-1">
                        {FILTER_CHIPS.map((chip) => {
                          const isActive = activeFilters.has(chip.id);
                          const count = filterCounts[chip.id] ?? 0;
                          return (
                            <button
                              key={chip.id}
                              type="button"
                              onClick={() => toggleFilter(chip.id)}
                              className={cn(
                                "w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-sm transition-colors",
                                isActive ? "bg-primary/10 text-primary" : "hover:bg-surface-hover text-text-primary",
                              )}
                            >
                              <span
                                className={cn(
                                  "h-4 w-4 rounded border flex-shrink-0 flex items-center justify-center text-[10px]",
                                  isActive ? "border-primary bg-primary text-white" : "border-border",
                                )}
                              >
                                {isActive ? "✓" : ""}
                              </span>
                              <span className="flex-1 min-w-0">{chip.label}</span>
                              {count > 0 && (
                                <span className="text-xs font-bold tabular-nums text-text-tertiary">{count}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <p className="px-3 pt-2 pb-1 text-[10px] text-text-tertiary leading-snug border-t border-border-light mt-1">
                        Counts follow the selected date range.
                      </p>
                    </div>
                  </>
                )}
              </div>
              )
            }
          />
        )}

        {/* ── Modular widget grid ───────────────────────────────────────── */}
        {viewsLoading ? (
          <div className="grid grid-cols-12 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={cn("h-48 animate-pulse rounded-2xl bg-surface-hover", i === 0 || i === 5 ? "col-span-12" : "col-span-12 md:col-span-6 lg:col-span-4")} />
            ))}
          </div>
        ) : ceoDashboard ? (
          <CeoFinancialDashboard key={dashboardRefreshKey} />
        ) : activeView ? (
          isOperationsView(activeView) ? (
            <OperationsStatus key={dashboardRefreshKey} />
          ) : (
          <div className="grid grid-cols-12 gap-5 items-stretch">
            {(() => {
              const orderedWidgets = injectOverviewPartnersWidget(
                orderCashFlowPartnersAboveJobsDonut(
                  [...activeView.widgets]
                    .filter((w) => !DASHBOARD_HIDDEN_WIDGET_TYPES.has(w.type))
                    .filter((w) => !isOverviewView(activeView) || !OVERVIEW_HIDDEN_WIDGET_TYPES.has(w.type)),
                ),
                activeView,
              );
              return orderedWidgets.map((widget, i) => (
                <motion.div
                  key={`${widget.id}-${dashboardRefreshKey}`}
                  variants={staggerItem}
                  initial="hidden"
                  animate="visible"
                  custom={i}
                  className={cn(getWidgetGridClass(widget, orderedWidgets, activeView), "h-full min-h-0")}
                >
                  <WidgetRenderer widget={widget} />
                </motion.div>
              ));
            })()}
          </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <LayoutDashboard className="h-12 w-12 text-text-tertiary mb-3 opacity-40" />
            <p className="text-base font-semibold text-text-secondary">No views available</p>
            {canEdit && (
              <Button className="mt-4" icon={<Plus className="h-4 w-4" />} onClick={openNewView}>
                Create first view
              </Button>
            )}
          </div>
        )}

        {/* View editor modal */}
        <DashboardViewEditor
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          editView={editingView}
        />
      </div>
    </PageTransition>
  );
}

// ─── Page (wraps provider) ────────────────────────────────────────────────────
export default function DashboardPage() {
  return (
    <DashboardConfigProvider>
      <DashboardDateRangeProvider>
        <DashboardInner />
      </DashboardDateRangeProvider>
    </DashboardConfigProvider>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
