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
import { useRouter } from "next/navigation";
import { DashboardConfigProvider, useDashboardConfig } from "@/hooks/use-dashboard-config";
import { WidgetRenderer } from "@/components/dashboard/widget-renderer";
import { DashboardViewEditor } from "@/components/dashboard/dashboard-view-editor";
import type { DashboardView, WidgetConfig } from "@/types/dashboard-config";
import {
  LayoutDashboard, DollarSign, Briefcase, BarChart2, PieChart,
  Activity, Users, Settings, Layers, Plus, Pencil, ChevronRight, SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

// ─── Dashboard inner (needs context) ─────────────────────────────────────────
function DashboardInner() {
  const { profile } = useProfile();
  const firstName = profile?.full_name?.split(" ")[0] || "there";
  const router = useRouter();
  const { visibleViews, loading: viewsLoading, canEdit } = useDashboardConfig();

  const [activeFilters, setActiveFilters] = useState<Set<DashboardFilter>>(new Set());
  const [filterCounts, setFilterCounts] = useState<Record<string, number>>({});
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingView, setEditingView] = useState<DashboardView | null>(null);

  // Set default view when views load
  useEffect(() => {
    if (visibleViews.length > 0 && !activeViewId) {
      const def = visibleViews.find((v) => v.is_default) ?? visibleViews[0];
      setActiveViewId(def.id);
    }
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
      const [jobsRes, invoicesRes] = await Promise.all([
        supabase.from("jobs").select("id, status, partner_id, partner_name, quote_id, margin_percent, finance_status, report_submitted, commission"),
        supabase.from("invoices").select("id, job_reference"),
      ]);
      const jobs = (jobsRes.data ?? []) as {
        id: string; status: string; partner_id?: string; partner_name?: string;
        quote_id?: string; margin_percent: number; finance_status?: string;
        report_submitted?: boolean; commission?: number;
      }[];
      const invoiceRefs = new Set((invoicesRes.data ?? []).map((i: { job_reference?: string }) => i.job_reference).filter(Boolean));
      setFilterCounts({
        commission_pending: jobs.filter((j) => (j.commission ?? 0) > 0 && j.finance_status !== "paid").length,
        awaiting_payment:   jobs.filter((j) => j.status === "awaiting_payment").length,
        without_invoice:    jobs.filter((j) => !invoiceRefs.has(j.id) && j.status !== "completed").length,
        without_selfbill:   jobs.filter((j) => !!j.partner_name && j.status === "completed").length,
        without_report:     jobs.filter((j) => !j.report_submitted && !["completed", "scheduled"].includes(j.status)).length,
        without_partner:    jobs.filter((j) => !j.partner_id && !j.partner_name).length,
        without_quote:      jobs.filter((j) => !j.quote_id).length,
        low_margin:         jobs.filter((j) => j.margin_percent < 20 && j.margin_percent > 0).length,
        financial_status:   jobs.filter((j) => j.finance_status !== "paid" && !["completed", "scheduled"].includes(j.status)).length,
      });
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { loadFilterCounts(); }, [loadFilterCounts]);

  const greeting = getGreeting();

  const openNewView = () => { setEditingView(null); setEditorOpen(true); };
  const openEditView = (view: DashboardView) => { setEditingView(view); setEditorOpen(true); };

  return (
    <PageTransition>
      <div className="space-y-5">
        {/* Header */}
        <PageHeader title={`${greeting}, ${firstName}`}>
          <Badge variant="success" dot pulse size="md">Live</Badge>
        </PageHeader>

        {/* ── View picker ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          {viewsLoading
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-8 w-24 animate-pulse rounded-xl bg-surface-hover" />
              ))
            : visibleViews.map((view) => {
                const IconComp = ICON_MAP[view.icon] ?? LayoutDashboard;
                const isActive = view.id === activeViewId;
                return (
                  <button
                    key={view.id}
                    onClick={() => setActiveViewId(view.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-medium border transition-all",
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
                        onClick={(e) => { e.stopPropagation(); openEditView(view); }}
                        className="ml-1 p-0.5 rounded hover:bg-white/20 transition-colors"
                      >
                        <Pencil className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </button>
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
        {activeView?.description && (
          <p className="text-xs text-text-tertiary -mt-1">{activeView.description}</p>
        )}

        {/* ── Filter chips ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mr-1 flex items-center gap-1">
            <SlidersHorizontal className="h-3 w-3" /> Filters:
          </span>
          {FILTER_CHIPS.map((chip) => {
            const isActive = activeFilters.has(chip.id);
            const count = filterCounts[chip.id] ?? 0;
            return (
              <button
                key={chip.id}
                onClick={() => toggleFilter(chip.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
                  isActive ? "bg-primary text-white border-primary shadow-sm" : chip.color
                }`}
              >
                {chip.label}
                {count > 0 && (
                  <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                    isActive ? "bg-white/20 text-white" : "bg-black/10 text-current"
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          {activeFilters.size > 0 && (
            <button
              onClick={() => setActiveFilters(new Set())}
              className="text-xs font-medium text-text-tertiary hover:text-primary underline underline-offset-2 ml-1"
            >
              Clear all
            </button>
          )}
        </div>

        {/* ── Modular widget grid ───────────────────────────────────────── */}
        {viewsLoading ? (
          <div className="grid grid-cols-12 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={cn("h-48 animate-pulse rounded-2xl bg-surface-hover", i === 0 || i === 5 ? "col-span-12" : "col-span-12 md:col-span-6 lg:col-span-4")} />
            ))}
          </div>
        ) : activeView ? (
          <div className="grid grid-cols-12 gap-5">
            {[...activeView.widgets]
              .sort((a, b) => a.position - b.position)
              .map((widget, i) => (
                <motion.div
                  key={widget.id}
                  variants={staggerItem}
                  initial="hidden"
                  animate="visible"
                  custom={i}
                  className={getColSpanClass(widget.size)}
                >
                  <WidgetRenderer widget={widget} />
                </motion.div>
              ))}
          </div>
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
      <DashboardInner />
    </DashboardConfigProvider>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
