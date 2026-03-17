"use client";

import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card } from "@/components/ui/card";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import { ChevronLeft, ChevronRight, CalendarClock, DollarSign, Download, Loader2, CheckCircle2 } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import type { PayRun, PayRunItem } from "@/types/database";
import {
  getWeekBounds,
  getOrCreatePayRun,
  getPayRunWithItems,
  buildPayRunItems,
  markPayRunItemsPaid,
  exportPayRunToCsv,
} from "@/services/pay-runs";

export default function PayRunPage() {
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [payRun, setPayRun] = useState<PayRun | null>(null);
  const [items, setItems] = useState<PayRunItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState(false);

  const { week_start, week_end } = getWeekBounds(weekAnchor);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const run = await getOrCreatePayRun(week_start, week_end);
      setPayRun(run);
      await buildPayRunItems(run.id, week_start, week_end);
      const list = await getPayRunWithItems(run.id);
      setItems(list);
    } catch {
      toast.error("Failed to load pay run");
    } finally {
      setLoading(false);
    }
  }, [week_start, week_end]);

  useEffect(() => {
    load();
  }, [load]);

  const dueThisWeek = items.filter((i) => i.status === "pending");
  const paidThisWeek = items.filter((i) => i.status === "paid");
  const overdue = items.filter((i) => i.status === "pending" && i.due_date && i.due_date < week_start);

  const totalDue = dueThisWeek.reduce((s, i) => s + Number(i.amount), 0);
  const totalPaid = paidThisWeek.reduce((s, i) => s + Number(i.amount), 0);

  const goPrev = () => setWeekAnchor((d) => { const x = new Date(d); x.setDate(x.getDate() - 7); return x; });
  const goNext = () => setWeekAnchor((d) => { const x = new Date(d); x.setDate(x.getDate() + 7); return x; });

  const handlePaySelected = async () => {
    if (selectedIds.size === 0) {
      toast.error("Select at least one item");
      return;
    }
    setPaying(true);
    try {
      await markPayRunItemsPaid(Array.from(selectedIds));
      toast.success(`${selectedIds.size} item(s) marked as paid`);
      setSelectedIds(new Set());
      load();
    } catch {
      toast.error("Failed to mark paid");
    } finally {
      setPaying(false);
    }
  };

  const handleExport = () => {
    const csv = exportPayRunToCsv(items, week_start, week_end);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pay-run-${week_start}-${week_end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported for Xero");
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllPending = () => {
    setSelectedIds(new Set(dueThisWeek.map((i) => i.id)));
  };

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader
          title="Pay Run"
          subtitle="Weekly payment hub. Payroll (commissions) + Self-bills + Bills."
        >
          <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExport}>
            Export CSV (Xero)
          </Button>
        </PageHeader>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" icon={<ChevronLeft className="h-4 w-4" />} onClick={goPrev} />
            <Card padding="md" className="min-w-[200px] text-center">
              <p className="text-xs text-text-tertiary uppercase tracking-wide">Week</p>
              <p className="text-lg font-bold text-text-primary">
                {formatDate(week_start)} – {formatDate(week_end)}
              </p>
            </Card>
            <Button variant="outline" size="sm" icon={<ChevronRight className="h-4 w-4" />} onClick={goNext} />
          </div>
        </div>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard title="Due this week" value={totalDue} format="currency" description={`${dueThisWeek.length} items`} icon={DollarSign} accent="amber" />
          <KpiCard title="Overdue" value={overdue.length} format="number" description="pending from before" icon={CalendarClock} accent="amber" />
          <KpiCard title="Paid this week" value={totalPaid} format="currency" description={`${paidThisWeek.length} items`} icon={CheckCircle2} accent="emerald" />
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-text-primary">Items</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={selectAllPending}>
                Select all pending
              </Button>
              <Button
                size="sm"
                disabled={selectedIds.size === 0 || paying}
                icon={paying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                onClick={handlePaySelected}
              >
                Pay selected ({selectedIds.size})
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-text-tertiary">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-hover">
                    <th className="text-left p-3 w-10">
                      <input
                        type="checkbox"
                        checked={dueThisWeek.length > 0 && selectedIds.size === dueThisWeek.length}
                        onChange={(e) => (e.target.checked ? selectAllPending() : setSelectedIds(new Set()))}
                      />
                    </th>
                    <th className="text-left p-3">Type</th>
                    <th className="text-left p-3">Description</th>
                    <th className="text-right p-3">Amount</th>
                    <th className="text-left p-3">Due</th>
                    <th className="text-left p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id} className="border-b border-border last:border-0">
                      <td className="p-3">
                        {i.status === "pending" && (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(i.id)}
                            onChange={() => toggleSelect(i.id)}
                          />
                        )}
                      </td>
                      <td className="p-3 capitalize text-text-secondary">{i.item_type.replace("_", " ")}</td>
                      <td className="p-3 font-medium text-text-primary">{i.source_label ?? i.source_id}</td>
                      <td className="p-3 text-right font-medium">{formatCurrency(i.amount)}</td>
                      <td className="p-3 text-text-tertiary">{i.due_date ? formatDate(i.due_date) : "—"}</td>
                      <td className="p-3">
                        <span className={i.status === "paid" ? "text-emerald-600 font-medium" : "text-amber-600"}>
                          {i.status === "paid" ? "Paid" : "Pending"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {items.length === 0 && (
                <p className="p-8 text-center text-text-tertiary">No items due this week. Change week or add approved bills / ready self-bills.</p>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </PageTransition>
  );
}
