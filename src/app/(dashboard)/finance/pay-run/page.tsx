"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { parseISO, isValid, getISOWeek, getISOWeekYear } from "date-fns";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition, StaggerContainer } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/ui/kpi-card";
import { Tabs } from "@/components/ui/tabs";
import { FinanceWeekRangeBar } from "@/components/finance/finance-week-range-bar";
import { type FinancePeriodMode, DEFAULT_FINANCE_PERIOD_MODE } from "@/lib/finance-period";
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
  syncPayRunItems,
  markPayRunItemsPaid,
  exportPayRunToCsv,
  decodePayRunLabel,
  payRunItemTypeLabel,
  payRunQueueBucket,
  fetchSelfBillStatusesByIds,
} from "@/services/pay-runs";
import { getWeekBoundsForDate } from "@/lib/self-bill-period";

type TypeFilter = "all" | "partner" | "workforce" | "bill";
type StatusFilter = "all" | "draft" | "approved_to_pay" | "paid";

export default function PayRunPage() {
  const [periodMode, setPeriodMode] = useState<FinancePeriodMode>(DEFAULT_FINANCE_PERIOD_MODE);
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [items, setItems] = useState<PayRunItem[]>([]);
  const [selfBillStatusById, setSelfBillStatusById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const boundsDate = useMemo(() => {
    if (periodMode === "range" && rangeFrom.trim()) {
      const d = parseISO(rangeFrom.trim());
      if (isValid(d)) return d;
    }
    if (periodMode === "month") {
      return new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
    }
    return weekAnchor;
  }, [periodMode, rangeFrom, weekAnchor, monthAnchor]);

  const { week_start, week_end } = getWeekBounds(boundsDate);

  const payRunKpiDesc = useMemo(() => {
    const { weekLabel, weekStart, weekEnd } = getWeekBoundsForDate(boundsDate);
    return `${weekLabel} · ${weekStart}–${weekEnd}`;
  }, [boundsDate]);

  const weekNumberLine = useMemo(() => {
    const wn = getISOWeek(boundsDate);
    const wy = getISOWeekYear(boundsDate);
    return `Week ${wn} (${wy})`;
  }, [boundsDate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const run = await getOrCreatePayRun(week_start, week_end);
      await syncPayRunItems(run.id, week_start, week_end);
      const list = await getPayRunWithItems(run.id);
      setItems(list);
      const sbIds = list.filter((i) => i.item_type === "self_bill").map((i) => i.source_id);
      try {
        setSelfBillStatusById(await fetchSelfBillStatusesByIds(sbIds));
      } catch {
        setSelfBillStatusById({});
      }
    } catch (e) {
      console.error("Pay run load failed", e);
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in (e as object)
            ? String((e as { message: unknown }).message)
            : "Failed to load pay run";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [week_start, week_end]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [week_start, typeFilter, statusFilter]);

  const displayRows = useMemo(() => {
    let rows = items;
    if (typeFilter !== "all") {
      rows = rows.filter((i) => {
        if (typeFilter === "partner") return i.item_type === "self_bill";
        if (typeFilter === "workforce") return i.item_type === "internal_cost";
        if (typeFilter === "bill") return i.item_type === "bill";
        return true;
      });
    }
    if (statusFilter === "all") return rows;
    return rows.filter((i) => {
      const bucket = payRunQueueBucket(i, selfBillStatusById[i.source_id]);
      if (statusFilter === "paid") return bucket === "paid";
      if (statusFilter === "draft") return bucket === "draft";
      if (statusFilter === "approved_to_pay") return bucket === "approved_to_pay";
      return true;
    });
  }, [items, typeFilter, statusFilter, selfBillStatusById]);

  const dueThisWeek = items.filter((i) => i.status === "pending");
  const paidThisWeek = items.filter((i) => i.status === "paid");
  const overdue = items.filter((i) => i.status === "pending" && i.due_date && i.due_date < week_start);
  const visiblePending = displayRows.filter((i) => i.status === "pending");

  const totalDue = dueThisWeek.reduce((s, i) => s + Number(i.amount), 0);
  const totalPaid = paidThisWeek.reduce((s, i) => s + Number(i.amount), 0);

  const statusTabs = useMemo(() => {
    const bucket = (i: PayRunItem) => payRunQueueBucket(i, selfBillStatusById[i.source_id]);
    return [
      { id: "all" as const, label: "All", count: items.length },
      {
        id: "draft" as const,
        label: "Draft",
        count: items.filter((i) => bucket(i) === "draft").length,
      },
      {
        id: "approved_to_pay" as const,
        label: "Approved to pay",
        count: items.filter((i) => bucket(i) === "approved_to_pay").length,
      },
      {
        id: "paid" as const,
        label: "Paid",
        count: items.filter((i) => bucket(i) === "paid").length,
      },
    ];
  }, [items, selfBillStatusById]);

  const typeTabs = useMemo(
    () => [
      { id: "all" as const, label: "All", count: items.length },
      {
        id: "partner" as const,
        label: "Partner",
        count: items.filter((i) => i.item_type === "self_bill").length,
      },
      {
        id: "workforce" as const,
        label: "Workforce",
        count: items.filter((i) => i.item_type === "internal_cost").length,
      },
      {
        id: "bill" as const,
        label: "Bills",
        count: items.filter((i) => i.item_type === "bill").length,
      },
    ],
    [items],
  );

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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to mark paid");
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
    toast.success("CSV exported");
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisiblePending = () => {
    setSelectedIds(new Set(visiblePending.map((i) => i.id)));
  };

  const weekRangeShort = `${formatDate(week_start)} – ${formatDate(week_end)}`;

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader
          title="Pay Run"
          subtitle={`${weekNumberLine} · Execute partner self-bills, workforce payroll, and supplier bills already approved in Finance.`}
        >
          <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExport}>
            Export CSV
          </Button>
        </PageHeader>

        <FinanceWeekRangeBar
          showAllOption={false}
          mode={periodMode}
          onModeChange={handlePeriodModeChange}
          weekAnchor={weekAnchor}
          onWeekAnchorChange={setWeekAnchor}
          monthAnchor={monthAnchor}
          onMonthAnchorChange={setMonthAnchor}
          rangeFrom={rangeFrom}
          rangeTo={rangeTo}
          onRangeFromChange={handleRangeFromChange}
          onRangeToChange={setRangeTo}
          rangeHelperText="Pay run is weekly. Monthly and date range select the week anchor."
        />

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard
            title="Due this week"
            value={totalDue}
            format="currency"
            description={`${dueThisWeek.length} unpaid · ${payRunKpiDesc}`}
            icon={DollarSign}
            accent="amber"
          />
          <KpiCard
            title="Overdue (before week)"
            value={overdue.length}
            format="number"
            description={`Due date before ${formatDate(week_start)} · still pending in this run`}
            icon={CalendarClock}
            accent="amber"
          />
          <KpiCard
            title="Marked paid (this run)"
            value={totalPaid}
            format="currency"
            description={`${paidThisWeek.length} item${paidThisWeek.length === 1 ? "" : "s"} · ${payRunKpiDesc}`}
            icon={CheckCircle2}
            accent="emerald"
          />
        </StaggerContainer>

        <motion.div variants={fadeInUp} initial="hidden" animate="visible" className="space-y-3">
          <div className="flex flex-col gap-3 min-w-0">
            <div className="min-w-0 overflow-x-auto pb-0.5 -mb-0.5 [scrollbar-width:thin]">
              <Tabs
                variant="pills"
                tabs={statusTabs.map((t) => ({ id: t.id, label: t.label, count: t.count }))}
                activeTab={statusFilter}
                onChange={(id) => setStatusFilter(id as StatusFilter)}
              />
            </div>
            <div className="min-w-0 overflow-x-auto pb-0.5 -mb-0.5 [scrollbar-width:thin]">
              <Tabs
                variant="pills"
                tabs={typeTabs.map((t) => ({ id: t.id, label: t.label, count: t.count }))}
                activeTab={typeFilter}
                onChange={(id) => setTypeFilter(id as TypeFilter)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-sm font-semibold text-text-primary">Payment queue</h3>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={selectAllVisiblePending} disabled={visiblePending.length === 0}>
                Select all unpaid (visible)
              </Button>
              <Button
                size="sm"
                disabled={selectedIds.size === 0 || paying}
                icon={paying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                onClick={handlePaySelected}
              >
                Mark selected as paid ({selectedIds.size})
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-text-tertiary">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="border-b border-border bg-surface-hover">
                    <th className="text-left p-3 w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all visible unpaid"
                        checked={
                          visiblePending.length > 0 && visiblePending.every((i) => selectedIds.has(i.id))
                        }
                        onChange={(e) => (e.target.checked ? selectAllVisiblePending() : setSelectedIds(new Set()))}
                      />
                    </th>
                    <th className="text-left p-3">Type</th>
                    <th className="text-left p-3">Name</th>
                    <th className="text-left p-3">Reference</th>
                    <th className="text-right p-3">Amount due</th>
                    <th className="text-left p-3">Week</th>
                    <th className="text-left p-3">Due date</th>
                    <th className="text-left p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((i) => {
                    const { name, reference } = decodePayRunLabel(i.source_label);
                    const queueBucket = payRunQueueBucket(i, selfBillStatusById[i.source_id]);
                    const statusLabel =
                      queueBucket === "paid"
                        ? "Paid"
                        : queueBucket === "draft"
                          ? "Draft"
                          : "Approved to pay";
                    const statusClass =
                      queueBucket === "paid"
                        ? "text-emerald-600 font-medium"
                        : queueBucket === "draft"
                          ? "text-text-secondary font-medium"
                          : "text-amber-600 font-medium";
                    return (
                      <tr key={i.id} className="border-b border-border last:border-0">
                        <td className="p-3">
                          {i.status === "pending" ? (
                            <input
                              type="checkbox"
                              checked={selectedIds.has(i.id)}
                              onChange={() => toggleSelect(i.id)}
                              aria-label={`Select ${name}`}
                            />
                          ) : (
                            <span className="inline-block w-4" />
                          )}
                        </td>
                        <td className="p-3 text-text-secondary whitespace-nowrap">{payRunItemTypeLabel(i.item_type)}</td>
                        <td className="p-3 font-medium text-text-primary max-w-[200px] truncate" title={name}>
                          {name}
                        </td>
                        <td className="p-3 text-text-secondary max-w-[180px] truncate font-mono text-xs" title={reference}>
                          {reference}
                        </td>
                        <td className="p-3 text-right font-semibold tabular-nums">{formatCurrency(i.amount)}</td>
                        <td className="p-3 text-text-tertiary text-xs whitespace-nowrap">{weekRangeShort}</td>
                        <td className="p-3 text-text-secondary whitespace-nowrap">
                          {i.due_date ? formatDate(i.due_date) : "—"}
                        </td>
                        <td className="p-3">
                          <span className={statusClass}>{statusLabel}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {displayRows.length === 0 && (
                <p className="p-8 text-center text-text-tertiary max-w-lg mx-auto">
                  No lines for this combination of status (Draft / Approved to pay / Paid) and type (Partner / Workforce /
                  Bills). Change filters, or change the week above. Items appear when partner self-bills, workforce payroll, and
                  approved supplier bills fall in this run.
                </p>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </PageTransition>
  );
}
