"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { parseISO, isValid } from "date-fns";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/ui/kpi-card";
import { FinanceWeekRangeBar } from "@/components/finance/finance-week-range-bar";
import type { FinancePeriodMode } from "@/lib/finance-period";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";
import { CalendarClock, DollarSign, Download, Loader2, CheckCircle2 } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import type { PayRunItem } from "@/types/database";
import {
  getWeekBounds,
  getOrCreatePayRun,
  getPayRunWithItems,
  buildPayRunItems,
  markPayRunItemsPaid,
  exportPayRunToCsv,
} from "@/services/pay-runs";
import { getWeekBoundsForDate } from "@/lib/self-bill-period";

export default function PayRunPage() {
  const [periodMode, setPeriodMode] = useState<FinancePeriodMode>("week");
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [items, setItems] = useState<PayRunItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState(false);

  const boundsDate = useMemo(() => {
    if (periodMode === "range" && rangeFrom.trim()) {
      const d = parseISO(rangeFrom.trim());
      if (isValid(d)) return d;
    }
    return weekAnchor;
  }, [periodMode, rangeFrom, weekAnchor]);

  const { week_start, week_end } = getWeekBounds(boundsDate);

  const payRunKpiDesc = useMemo(() => {
    const { weekLabel, weekStart, weekEnd } = getWeekBoundsForDate(boundsDate);
    return `${weekLabel} · ${weekStart}–${weekEnd}`;
  }, [boundsDate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const run = await getOrCreatePayRun(week_start, week_end);
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

  const handlePeriodModeChange = (m: FinancePeriodMode) => {
    setPeriodMode(m);
    if (m === "range" && rangeFrom.trim()) {
      const d = parseISO(rangeFrom.trim());
      if (isValid(d)) setWeekAnchor(d);
    }
  };

  const handleRangeFromChange = (v: string) => {
    setRangeFrom(v);
    if (periodMode === "range" && v.trim()) {
      const d = parseISO(v.trim());
      if (isValid(d)) setWeekAnchor(d);
    }
  };

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
          subtitle="Weekly payment hub. Commissions + internal salary (active staff, due this week) + self-bills + bills."
        >
          <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExport}>
            Export CSV (Xero)
          </Button>
        </PageHeader>

        <FinanceWeekRangeBar
          showAllOption={false}
          mode={periodMode}
          onModeChange={handlePeriodModeChange}
          weekAnchor={weekAnchor}
          onWeekAnchorChange={setWeekAnchor}
          rangeFrom={rangeFrom}
          rangeTo={rangeTo}
          onRangeFromChange={handleRangeFromChange}
          onRangeToChange={setRangeTo}
          rangeHelperText="Pay run is weekly. In date range mode, the week containing “From” is used (adjust “From” to jump to another week)."
        />

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard
            title="Due this week"
            value={totalDue}
            format="currency"
            description={`${dueThisWeek.length} item${dueThisWeek.length === 1 ? "" : "s"} · ${payRunKpiDesc}`}
            icon={DollarSign}
            accent="amber"
          />
          <KpiCard
            title="Overdue"
            value={overdue.length}
            format="number"
            description={`Before ${week_start} · ${payRunKpiDesc}`}
            icon={CalendarClock}
            accent="amber"
          />
          <KpiCard
            title="Paid this week"
            value={totalPaid}
            format="currency"
            description={`${paidThisWeek.length} item${paidThisWeek.length === 1 ? "" : "s"} · ${payRunKpiDesc}`}
            icon={CheckCircle2}
            accent="emerald"
          />
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
